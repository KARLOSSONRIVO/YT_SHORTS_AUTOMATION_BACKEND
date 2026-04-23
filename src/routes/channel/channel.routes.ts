import { Router } from "express";
import { asyncHandler } from "../../common/middlewares/async-handler.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { ChannelController } from "../../modules/controllers/channel/channel.controller";
import { channelIdParamsSchema, connectChannelBodySchema } from "../../modules/validators/channel.validator";

export const createChannelRoutes = (channelController: ChannelController): Router => {
  const router = Router();

  router.get("/oauth/url", asyncHandler(channelController.getAuthorizationUrl));
  router.post("/", validate({ body: connectChannelBodySchema }), asyncHandler(channelController.connectChannel));
  router.get("/", asyncHandler(channelController.listChannels));
  router.delete("/:channelId", validate({ params: channelIdParamsSchema }), asyncHandler(channelController.disconnectChannel));

  return router;
};
