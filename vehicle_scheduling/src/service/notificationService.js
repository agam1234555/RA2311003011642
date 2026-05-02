const axios = require("axios");
const { Log } = require("../../../logging_middleware/logger");

const AUTH_URL = "http://20.207.122.201/evaluation-service/auth";
const NOTIF_URL = "http://20.207.122.201/evaluation-service/notifications";

const WEIGHT = {
  placement: 3,
  result: 2,
  event: 1,
};

const getToken = async () => {
  const res = await axios.post(AUTH_URL, {
    email: "ab5903@srmist.edu.in",
    name: "Agam Singh Bhatia",
    rollNo: "RA2311003011642",
    accessCode: "QkbpxH",
    clientID: "8b2a6b3f-af39-4220-8afe-40a4d2aa91ad",
    clientSecret: "zCdwcWrFrfKECShs",
  });
  return res.data.access_token;
};

const getTopNotifications = async (topN = 10) => {
  await Log("backend", "info", "service", `Service: fetching top ${topN} priority notifications`);

  const token = await getToken();

  const res = await axios.get(NOTIF_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const notifications = res.data.notifications || res.data || [];
  await Log("backend", "info", "service", `Service: fetched ${notifications.length} notifications`);

  // Score each notification
  const scored = notifications.map((n, index) => {
    const typeWeight = WEIGHT[n.notification_type?.toLowerCase()] || 1;
    const recencyScore = notifications.length - index;
    const finalScore = typeWeight * 1000 + recencyScore;
    return { ...n, finalScore };
  });

  // Sort by finalScore descending
  scored.sort((a, b) => b.finalScore - a.finalScore);

  // Return top N
  const topNotifications = scored.slice(0, topN);

  await Log("backend", "info", "service", `Service: returning top ${topNotifications.length} notifications`);

  return {
    success: true,
    topN,
    total: notifications.length,
    notifications: topNotifications,
  };
};

module.exports = { getTopNotifications };