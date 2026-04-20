import { Router } from "express";
import { asyncHandler } from "../../common/middlewares/async-handler.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { ChannelController } from "../../modules/controllers/channel/channel.controller";
import {
  channelIdParamsSchema,
  channelUserQuerySchema,
  connectChannelBodySchema,
  connectChannelCallbackQuerySchema
} from "../../modules/validators/channel.validator";

export const createChannelRoutes = (channelController: ChannelController): Router => {
  const router = Router();

  router.get("/oauth/url", validate({ query: channelUserQuerySchema }), asyncHandler(channelController.getAuthorizationUrl));
  router.get(
    "/oauth/callback",
    validate({ query: connectChannelCallbackQuerySchema }),
    asyncHandler(channelController.connectChannelFromCallback)
  );
  router.post("/", validate({ body: connectChannelBodySchema }), asyncHandler(channelController.connectChannel));
  router.get("/", validate({ query: channelUserQuerySchema }), asyncHandler(channelController.listChannels));
  router.delete(
    "/:channelId",
    validate({ params: channelIdParamsSchema, query: channelUserQuerySchema }),
    asyncHandler(channelController.disconnectChannel)
  );

  return router;
};
