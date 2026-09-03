import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import robinhoodRouter from "./robinhood";
import economyRouter from "./economy";
import discoveryRouter from "./discovery";
import labyrinthsRouter from "./labyrinths";
import upgradesRouter from "./upgrades";
import roomsRouter from "./rooms";
import tollGateRouter from "./tollgate";
import runsRouter from "./runs";
import itemsRouter from "./items";
import loadoutRouter from "./loadout";
import craftingRouter from "./crafting";
import overworldRouter from "./overworld";
import tradeRouter from "./trade";
import marketplaceRouter from "./marketplace";
import coopRouter from "./coop";
import duelRouter from "./duel";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(robinhoodRouter);
router.use(economyRouter);
router.use(discoveryRouter);
// Specific labyrinth sub-resources (upgrades, room-types, toll-gate) before the generic /labyrinths/:id router
router.use(upgradesRouter);
router.use(roomsRouter);
router.use(tollGateRouter);
router.use(labyrinthsRouter);
router.use(runsRouter);
router.use(itemsRouter);
router.use(loadoutRouter);
router.use(craftingRouter);
router.use(overworldRouter);
router.use(tradeRouter);
router.use(marketplaceRouter);
router.use(coopRouter);
router.use(duelRouter);

export default router;
