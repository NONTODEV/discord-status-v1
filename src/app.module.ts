import { Module, OnModuleInit } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DiscordModule } from './discord/discord.module';
import { MongooseModule } from '@nestjs/mongoose';
import { mongodb } from '../config.json';

@Module({
  imports: [
    DiscordModule,
    MongooseModule.forRoot(mongodb),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements OnModuleInit {
  onModuleInit() {
    console.log('Connected to MongoDB successfully');
  }
}