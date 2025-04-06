import express from "express";
import {
  createOrder,
  updateOrderStatus,
  getOrder,
  getClientOrders,
  getFreelancerOrders,
  cancelOrder,
  getCurrentOrders,
  getPendingOrders,
  getCompletedOrders,
} from "../Controllers/order.controller.js";
import { authenticateToken } from "../Middlewares/protect.middleware.js";
import { validateBody, validateQuery } from "../Middlewares/validate.middleware.js";
import Joi from "joi";

const router = express.Router();

// Validation schemas
const createOrderSchema = Joi.object({
  gigId: Joi.number().integer().required(),
  selectedPackage: Joi.string().required(),
  requirements: Joi.string().optional(),
  isUrgent: Joi.boolean().optional(),
  customDetails: Joi.object().optional(),
});

const updateStatusSchema = Joi.object({
  status: Joi.string().valid("PENDING", "ACCEPTED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "CANCELLED", "DISPUTED").required(),
  extensionReason: Joi.string().optional(),
  cancellationReason: Joi.string().optional(),
});

const cancelOrderSchema = Joi.object({
  cancellationReason: Joi.string().optional(),
});

const getOrdersSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  status: Joi.string().valid("PENDING", "ACCEPTED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "CANCELLED", "DISPUTED").optional(),
});

router.use(authenticateToken);

// Static routes first
router.post("/", validateBody(createOrderSchema), createOrder);
router.get("/client", validateQuery(getOrdersSchema), getClientOrders);
router.get("/freelancer", validateQuery(getOrdersSchema), getFreelancerOrders);
router.get("/current", getCurrentOrders);
router.get("/pending", getPendingOrders); // Moved up
router.get("/completed", getCompletedOrders); // Moved up

// Dynamic routes last
router.patch("/:orderId/status", validateBody(updateStatusSchema), updateOrderStatus);
router.patch("/:orderId/cancel", validateBody(cancelOrderSchema), cancelOrder);
router.get("/:orderId", getOrder); // Moved down

export default router;