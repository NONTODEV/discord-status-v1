// src/discord/schema/status.schema.ts

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type StatusDocument = Status & Document;

@Schema({ timestamps: true })
export class Status {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  username: string;

  @Prop({ required: true })
  action: string; // 'status'

  @Prop({ required: true })
  timestamp: Date;

  @Prop({ required: true })
  serverName: string;
}

export const StatusSchema = SchemaFactory.createForClass(Status);
