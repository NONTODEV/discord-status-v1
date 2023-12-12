import { Injectable } from '@nestjs/common';
import * as Discord from 'discord.js';
import { token, serverId, channelIds } from '../../config.json';
import * as dayjs from 'dayjs';
import * as duration from 'dayjs/plugin/duration';
import 'dayjs/plugin/timezone';
import 'dayjs/plugin/utc';
import { VoiceState, GuildMember } from 'discord.js';  
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LogEntry } from './schema/log-entry.schema';
import { LogLeave } from './schema/log-leave.schema';
import { UserTotalTime } from './schema/user-total-tiem.schema';

dayjs.extend(duration);
dayjs.extend(require('dayjs/plugin/timezone'));
dayjs.extend(require('dayjs/plugin/utc'));

@Injectable()
export class DiscordService {
  private readonly client: Discord.Client;
  private userTimeMap: Map<string, { joinTime: string, speaking: boolean, inactivityTimer: NodeJS.Timeout }> = new Map();
  private totalTimes: Map<string, number> = new Map();

  constructor(
    @InjectModel(LogEntry.name) private readonly logEntryModel: Model<LogEntry>,
    @InjectModel(LogLeave.name) private readonly logLeaveModel: Model<LogLeave>,
    @InjectModel(UserTotalTime.name) private readonly userTotalTimeModel: Model<UserTotalTime>
  ) {
    this.client = new Discord.Client({
      intents: [
        Discord.GatewayIntentBits.GuildMessages,
        Discord.GatewayIntentBits.GuildMembers,
        Discord.GatewayIntentBits.DirectMessages,
        Discord.GatewayIntentBits.MessageContent,
        Discord.GatewayIntentBits.Guilds,
        Discord.GatewayIntentBits.GuildVoiceStates,
      ],
      partials: [
        Discord.Partials.Message,
        Discord.Partials.Channel,
        Discord.Partials.GuildMember,
        Discord.Partials.User,
        Discord.Partials.GuildScheduledEvent,
        Discord.Partials.ThreadMember,
      ],
    });

    this.client.once('ready', () => {
      console.log('Bot is now online!');
    });

    this.client.login(token);

    this.setupEventHandlers();
  }
  private async setupEventHandlers() {
    this.client.on('voiceStateUpdate', async (oldState, newState) => {
      try {
        const guild = await newState.guild.members.fetch(newState.member.user.id);
        const updatedState = {
          ...newState,
          member: guild,
        };
  
        // Get VoiceChannel or StageChannel from GuildMember's VoiceState
        const channel = updatedState.member.voice?.channel;
  
        // Check if the user is speaking
        const isSpeaking = channel?.members.has(updatedState.member.id) ?? false;
  
        if (channel && updatedState.guild.id === serverId && channel.id === channelIds.voiceChannel) {
          const entry = {
            username: updatedState.member.user.username,
            userId: updatedState.member.id,
            action: 'join',
            speaking: isSpeaking,
            timestamp: dayjs().tz('Asia/Bangkok').format(),
          };
  
          await this.logEntry(updatedState, entry);
  
          // Call the function to check speaking status
          this.checkSpeakingStatus(entry);
  
          // Check if the user is muted or deafened
          if (updatedState.serverDeaf || updatedState.selfDeaf) {
            // User is either server deafened or self deafened (muted)
            console.log(`User ${entry.username} status offline (muted or deafened)`);
          }
        }
  
        if (oldState.channelId === channelIds.voiceChannel && !newState.channelId) {
          // Get VoiceChannel or StageChannel from GuildMember's VoiceState
          const oldChannel = oldState.member.voice?.channel;
  
          // Check if the user was speaking before leaving
          const wasSpeaking = oldChannel?.members.has(oldState.member.id) ?? false;
  
          const entry = {
            username: oldState.member.user.username,
            userId: oldState.member.id,
            action: 'leave',
            speaking: wasSpeaking,
            timestamp: dayjs().tz('Asia/Bangkok').format(),
          };
  
          await this.logLeave(oldState, entry);
  
          // Call the function to check speaking status
          this.checkSpeakingStatus(entry);
  
          // Check if the user is muted or deafened
          if (oldState.serverDeaf || oldState.selfDeaf) {
            // User was either server deafened or self deafened (muted) when leaving
            console.log(`User ${entry.username} status offline (muted or deafened)`);
          }
        }
      } catch (error) {
        console.error('Error handling voiceStateUpdate event:', error);
      }
    });
  }
  
  // Add a function to check speaking status
  private checkSpeakingStatus(entry) {
    if (entry.speaking) {
      console.log(`User ${entry.username} status online`);
    } else {
      console.log(`User ${entry.username} status offline`);
  
      // Use setTimeout to perform an action after 5 seconds
      setTimeout(() => {
        // Check if the user is still offline after 5 seconds of silence
        const userStillOffline = this.totalTimes.get(entry.userId) === 0;
  
        if (userStillOffline) {
          console.log(`User ${entry.username} status offline after 5 seconds of silence`);
        }
      }, 5000);
    }
  }


  private async logEntry(newState, entry) {
    try {
      const logEntry = new this.logEntryModel({
        ...entry,
        timestamp: dayjs(entry.timestamp).tz('Asia/Bangkok').toDate(),
        serverName: newState.guild.name,
      });

      await logEntry.save();
      console.log('User join event saved to MongoDB:', logEntry);

      const message = `User ${entry.username} joined the voice channel at ${logEntry.timestamp} on server ${newState.guild.name}. Speaking: ${entry.speaking}`;
      this.sendLogMessage(channelIds.channelenter, message);

      this.userTimeMap.set(entry.userId, { joinTime: entry.timestamp, speaking: entry.speaking, inactivityTimer: null });
      
      if (entry.speaking) {
        console.log(`User ${entry.username} is speaking.`);
      } else {
        this.startInactivityTimer(entry.userId);
      }
    } catch (error) {
      console.error('Error logging entry:', error.message);
    }
  }

  private async logLeave(oldState, entry) {
    try {
      const logLeave = new this.logLeaveModel({
        ...entry,
        timestamp: dayjs(entry.timestamp).tz('Asia/Bangkok').toDate(),
        serverName: oldState.guild.name,
      });

      await logLeave.save();
      console.log('User leave event saved to MongoDB:', logLeave);

      const message = `User ${entry.username} left the voice channel at ${logLeave.timestamp} on server ${oldState.guild.name}. Speaking: ${entry.speaking}`;
      this.sendLogMessage(channelIds.channelleave, message);

      this.handleUserTotalTime(oldState, entry);
      this.clearInactivityTimer(entry.userId);
      this.userTimeMap.delete(entry.userId);
    } catch (error) {
      console.error('Error logging leave entry:', error.message);
    }
  }

  private async handleUserTotalTime(oldState, entry) {
    try {
      if (this.userTimeMap.has(entry.userId)) {
        const joinTime = dayjs(this.userTimeMap.get(entry.userId).joinTime);
        const leaveTime = dayjs(entry.timestamp);
        const duration = dayjs.duration(leaveTime.diff(joinTime));

        if (this.totalTimes.has(entry.userId)) {
          const totalTime = this.totalTimes.get(entry.userId);
          this.totalTimes.set(entry.userId, totalTime + duration.asMinutes());
        } else {
          this.totalTimes.set(entry.userId, duration.asMinutes());
        }

        await this.saveTotalTime(entry.userId, entry.username, this.totalTimes.get(entry.userId), oldState.guild.name);
        this.sendTotalTimeMessage(oldState, entry);
      }
    } catch (error) {
      console.error('Error handling user total time:', error.message);
    }
  }

  private async saveTotalTime(userId: string, discordName: string, totalTime: number, serverName: string) {
    try {
      const bangkokTime = dayjs().tz('Asia/Bangkok').format();
      const hours = Math.floor(totalTime / 60);
      const minutes = Math.floor(totalTime % 60);
      const seconds = Math.round((totalTime % 1) * 60);
      const existingRecord = await this.userTotalTimeModel.findOne({
        discordId: userId,
        createdAt: {
          $gte: dayjs(bangkokTime).startOf('day').toDate(),
          $lt: dayjs(bangkokTime).endOf('day').toDate(),
        },
      });

      if (existingRecord) {
        existingRecord.totalTime = {
          hours: hours.toString(),
          minutes: minutes.toString(),
          seconds: seconds.toString(),
        };
        existingRecord.serverName = serverName;
        await existingRecord.save();
        console.log(`Total time for User ${discordName} on ${bangkokTime} on server ${serverName} updated to ${hours} hours, ${minutes} minutes, ${seconds} seconds`);
      } else {
        const totalTimeEntry = new this.userTotalTimeModel({
          discordName,
          discordId: userId,
          totalTime: {
            hours: hours.toString(),
            minutes: minutes.toString(),
            seconds: seconds.toString(),
          },
          createdAt: dayjs(bangkokTime).toDate(),
          serverName,
        });
        await totalTimeEntry.save();
        console.log(`Total time for User ${discordName} on ${bangkokTime} on server ${serverName} saved: ${hours} hours, ${minutes} minutes, ${seconds} seconds`);
      }
    } catch (error) {
      console.error('Error saving total time entry:', error.message);
    }
  }

  private sendLogMessage(channelId: string, message: string) {
    const channel = this.client.guilds.cache.get(serverId).channels.cache.get(channelId) as Discord.TextChannel;
    if (channel) {
      channel.send(`\`\`\`${message}\`\`\``);
    }
  }

  private async sendTotalTimeMessage(oldState, entry) {
    try {
      if (channelIds.channeltotaltime) {
        const totalTimeInMinutes = this.totalTimes.get(entry.userId);
        const hours = Math.floor(totalTimeInMinutes / 60);
        const minutes = Math.floor(totalTimeInMinutes % 60);
        const seconds = Math.round((totalTimeInMinutes % 1) * 60);

        const totalChannel = oldState.guild.channels.cache.get(channelIds.channeltotaltime) as Discord.TextChannel;
        if (totalChannel) {
          const totalTimeMessage = `\`\`\`User ${entry.username} spent a total of ${hours} hours, ${minutes} minutes, ${seconds} seconds in the voice channel.\`\`\``;
          totalChannel.send(totalTimeMessage);
        } else {
          console.error(`Error: Channel with ID ${channelIds.channeltotaltime} not found.`);
        }
      }
    } catch (error) {
      console.error('Error sending total time message:', error.message);
    }
  }

  private startInactivityTimer(userId: string) {
    const inactivityTimer = setTimeout(() => {
      const userStatus = this.userTimeMap.get(userId);
      if (userStatus && !userStatus.speaking) {
        console.log(`User ${userId} is offline.`);
      }
    }, 5000); // 5 seconds

    // Save the timer reference in the userTimeMap
    this.userTimeMap.set(userId, { ...this.userTimeMap.get(userId), inactivityTimer });
  }

  private clearInactivityTimer(userId: string) {
    // Clear the inactivity timer if it exists
    const userStatus = this.userTimeMap.get(userId);
    if (userStatus && userStatus.inactivityTimer) {
      clearTimeout(userStatus.inactivityTimer);
    }
  }
}
