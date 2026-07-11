const { Schema } = require("mongoose");

module.exports = new Schema({
	guildId: { type: String, required: true, unique: true, index: true },
	channelId: { type: String, default: null },
	count: { type: Number, default: 0 },
	lastUserId: { type: String, default: null },
	highestCount: { type: Number, default: 0 },
	totalCounted: { type: Number, default: 0 },
	resets: { type: Number, default: 0 },
});
