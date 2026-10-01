import express from "express"
import { createNotification, getMyNotifications, getUnreadNotificationCount, markAllNotificationsAsRead, markNotificationAsRead } from "../controller/createNotificationController.js";

const router = express.Router() ;


router.post("/createNotification" , createNotification ) ;
router.get("/get-notification", getMyNotifications ) ;
router.get("/unread-notification", getUnreadNotificationCount ) ;
router.patch("/mark-read-notification", markNotificationAsRead ) ;
router.get("mark-all-read" , markAllNotificationsAsRead ) ;


export default router ;