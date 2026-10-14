import { createContext, useContext, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { toast } from "react-toastify";
import axios from "axios";

const NotificationContext = createContext();

export const useNotifications = () => useContext(NotificationContext);

// Header for whichever user is logged in (admin, doctor or lab)
const getAuthHeaders = () => {
  const aToken = localStorage.getItem("aToken");
  if (aToken) return { atoken: aToken };
  const dToken = localStorage.getItem("dToken");
  if (dToken) return { dtoken: dToken };
  const lToken = localStorage.getItem("lToken");
  return lToken ? { ltoken: lToken } : {};
};

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

  // Fetch notifications from server
  const fetchNotifications = async () => {
    try {
      const { data } = await axios.get(`${backendUrl}/api/notifications`, {
        headers: getAuthHeaders()
      });

      if (data.success) {
        setNotifications(data.notifications);
        setUnreadCount(data.notifications.filter(n => !n.read).length);
      }
    } catch (error) {
      console.error("Error fetching notifications:", error);
    }
  };

  // Connect with the token; the server puts us in the right room
  useEffect(() => {
    const token = localStorage.getItem("aToken") || localStorage.getItem("dToken") || localStorage.getItem("lToken");
    if (!token) return;

    fetchNotifications();

    // Live updates where the server supports them (Railway, Render). On Vercel there
    // is no live connection: stop retrying after a few tries and check every minute.
    const socket = io(backendUrl, { auth: { token }, reconnectionAttempts: 3 });
    socket.on("newNotification", (notification) => {
      setNotifications(prev => [notification, ...prev]);
      setUnreadCount(prev => prev + 1);
      toast.info(notification.title);
    });
    const poll = setInterval(() => {
      if (!socket.connected && document.visibilityState === "visible") fetchNotifications();
    }, 60000);

    return () => {
      clearInterval(poll);
      socket.close();
    };
  }, [backendUrl]);

  // Mark notification as read
  const markAsRead = async (notificationId) => {
    try {
      await axios.put(`${backendUrl}/api/notifications/read/${notificationId}`, {}, {
        headers: getAuthHeaders()
      });

      setNotifications(prev =>
        prev.map(n => n._id === notificationId ? { ...n, read: true } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error("Error marking notification as read:", error);
    }
  };

  // Mark all notifications as read
  const markAllAsRead = async () => {
    try {
      await axios.put(`${backendUrl}/api/notifications/read-all`, {}, {
        headers: getAuthHeaders()
      });

      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
    }
  };

  // Delete notification
  const deleteNotification = async (notificationId) => {
    try {
      await axios.delete(`${backendUrl}/api/notifications/${notificationId}`, {
        headers: getAuthHeaders()
      });

      const notification = notifications.find(n => n._id === notificationId);
      setNotifications(prev => prev.filter(n => n._id !== notificationId));
      if (notification && !notification.read) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error("Error deleting notification:", error);
    }
  };

  const value = {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};
