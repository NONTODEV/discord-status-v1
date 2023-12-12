import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class UserTotalTime extends Document {
  @Prop({ type: Object })
  totalTime: {
    hours: string;
    minutes: string;
    seconds: string;
  };

  @Prop()
  discordName: string;

  @Prop()
  discordId: string;

  @Prop()
  serverName: string;

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const UserTotalTimeSchema = SchemaFactory.createForClass(UserTotalTime);