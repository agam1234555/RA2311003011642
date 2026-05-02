const { getTopNotifications } = require("../service/notificationService");
const { Log } = require("../../../logging_middleware/logger");

const getTopN = async (req, res) => {
  await Log("backend", "info", "controller", "Controller: getTopN notifications invoked");
  try {
    const topN = parseInt(req.query.top) || 10;
    await Log("backend", "info", "controller", `Controller: requested top ${topN} notifications`);
    const result = await getTopNotifications(topN);
    await Log("backend", "info", "controller", `Controller: returning ${result.notifications.length} notifications`);
    return res.status(200).json(result);
  } catch (err) {
    await Log("backend", "error", "controller", `Controller: getTopN failed - ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = { getTopN };