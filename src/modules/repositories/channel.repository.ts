import { ChannelModel, type Channel, type ChannelDocument } from "../models/channel.model";

export class ChannelRepository {
  public createOrUpdateByExternalChannelId(
    userId: string,
    externalChannelId: string,
    payload: Partial<Channel>
  ): Promise<ChannelDocument | null> {
    return ChannelModel.findOneAndUpdate(
      { userId, externalChannelId },
      payload,
      { new: true, upsert: true }
    ).exec();
  }

  public findById(channelId: string): Promise<ChannelDocument | null> {
    return ChannelModel.findById(channelId).exec();
  }

  public findByIdAndUserId(channelId: string, userId: string): Promise<ChannelDocument | null> {
    return ChannelModel.findOne({ _id: channelId, userId }).exec();
  }

  public findByUserId(userId: string): Promise<ChannelDocument[]> {
    return ChannelModel.find({ userId }).sort({ createdAt: -1 }).exec();
  }

  public updateById(channelId: string, payload: Partial<Channel>): Promise<ChannelDocument | null> {
    return ChannelModel.findByIdAndUpdate(channelId, payload, { new: true }).exec();
  }
}
