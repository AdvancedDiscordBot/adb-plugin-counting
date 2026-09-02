const { Schema } = require("mongoose");

// Per-user counting stats for the member-scope /me/counting-stats page.
// The guild doc keeps the game state; these docs mirror each member's
// correct/fail record so the platform's {guildId, userId} query has data.
module.exports = new Schema({
	guildId: { type: String, required: true, index: true },
	userId: { type: String, required: true, index: true },
	correct: { type: Number, default: 0 },
	fails: { type: Number, default: 0 },
	highest: { type: Number, default: 0 },
	lastCountedAt: { type: Date, default: null },
});
