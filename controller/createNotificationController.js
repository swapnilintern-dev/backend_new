import Notification from "../model/notificationModel.js";


export const createNotification = async (req, res) => {
  try {
    const {
      recipientId,
      recipientType,
      title,
      message,
      type,
      referenceId,
      data,
    } = req.body;

    if (
      !recipientId ||
      !recipientType ||
      !title ||
      !message
    ) {
      return res.status(400).json({
        success: false,
        message: "Required fields are missing",
      });
    }

    const notification = await Notification.create({
      recipientId,
      recipientType,
      title,
      message,
      type,
      referenceId,
      data,
    });

    return res.status(201).json({
      success: true,
      message: "Notification created successfully",
      notification,
    });

  } catch (error) {

    console.error("Create notification error:", error);

    return res.status(500).json({
    
      success: false,
      message: "Failed to create notification",
      error: error.message,
    
    });
  }
};


export const getMyNotifications = async (req, res) => {
  
  try {
  
    const userId = req.id;

    const notifications = await Notification.find({
  
      recipientId: userId,
  
    })
      .sort({ createdAt: -1 })
      .limit(100);

    return res.status(200).json({
  
      success: true,
      count: notifications.length,
      notifications,
  
    });
  }
  
  catch (error) {

    console.error("Get notifications error:", error);

    return res.status(500).json({

      success: false,
      message: "Failed to fetch notifications",
      error: error.message,
   
    });
  }
};


export const getUnreadNotificationCount = async (req, res) => {
  
  try {
  
    const userId = req.id;

    const count = await Notification.countDocuments({
  
      recipientId: userId,
      isRead: false,
  
    });

    return res.status(200).json({
  
      success: true,
      count,
  
    });
  } 
  
  catch (error) {
  
    console.error("Unread count error:", error);

    return res.status(500).json({
     
      success: false,
      message: "Failed to get unread notification count",
   
    });
  }
};


export const markNotificationAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notification = await Notification.findOneAndUpdate(
     
      {
     
        _id: notificationId,
     
        recipientId: req.id,
     
      },
     
      {
        
        $set: {

          isRead: true,
  
        },
  
      },
  
      {
  
        new: true,
  
      }
  
    );

    if (!notification) {
  
      return res.status(404).json({
  
        success: false,
        message: "Notification not found",
  
      });
    }

    return res.status(200).json({
  
      success: true,
      message: "Notification marked as read",
  
      notification,
  
    });
  }
  catch (error) {
  
    console.error("Mark read error:", error);

    return res.status(500).json({
  
      success: false,
      message: "Failed to mark notification as read",
  
    });
  
  }
};


export const markAllNotificationsAsRead = async (req, res) => {
  
  try {
    await Notification.updateMany(
      {
        recipientId: req.id,
        isRead: false,
      },
      {
        $set: {
          isRead: true,
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read",
    });
  } 
  catch (error) {
  
    console.error("Mark all read error:", error);

    return res.status(500).json({
     
      success: false,
      message: "Failed to mark notifications as read",
  
    });
  }
};






