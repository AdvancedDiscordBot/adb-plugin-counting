"use strict";

/**
 * local-harness.js — offline smoke test for adb-plugin-counting.
 * Run: npm test   (node test/local-harness.js). No bot / no Mongo.
 *
 * Drives the counting game by firing fake "messageCreate" events through the
 * registered handler and asserting the count/reset/turn rules.
 */

const { createMockCtx } = require("./mock-ctx");
const { load } = require("../index");

let passed = 0;
let failed = 0;
function assert(cond, label) {
	if (cond) {
		console.log(`  PASS  ${label}`);
		passed++;
	} else {
		console.error(`  FAIL  ${label}`);
		failed++;
	}
}

const GUILD = "guild-1";
const CHAN = "count-chan";

// Fake message with the fields index.js's handler reads. Records side effects.
function fakeMessage({ id = "userA", bot = false, content, channelId = CHAN, guildId = GUILD }) {
	const calls = { deleted: false, reacted: [], sent: [] };
	const author = { bot, id, toString: () => `<@${id}>` };
	return {
		author,
		guild: { id: guildId },
		guildId,
		channelId,
		content,
		channel: {
			id: channelId,
			send: async (c) => {
				calls.sent.push(c);
				return { delete: async () => {} };
			},
		},
		react: async (e) => { calls.reacted.push(e); },
		delete: async () => { calls.deleted = true; },
		_calls: calls,
	};
}

async function run() {
	console.log("\n=== adb-plugin-counting — Local Harness ===\n");

	const { ctx, registeredCommands, registeredEvents, models, emitEvent } =
		createMockCtx({ pluginName: "adb-plugin-counting" });
	await load(ctx);

	assert(registeredCommands.has("counting"), "/counting registered");
	assert((registeredEvents.get("messageCreate") || []).length === 1, "messageCreate handler registered");

	const Model = models.get("plugin_adb-plugin-counting_counting");
	assert(!!Model, "counting model defined");
	const UserStats = models.get("plugin_adb-plugin-counting_userStats");
	assert(!!UserStats, "userStats model defined");
	const getData = () => Model.findOne({ guildId: GUILD });
	const getUser = (id) => UserStats.findOne({ guildId: GUILD, userId: id });

	// Seed the counting channel via the /counting channel subcommand (bot-faithful).
	const cmd = registeredCommands.get("counting");
	const replies = [];
	let acknowledged = false;
	const getConfig = ctx.db.getPluginConfig;
	ctx.db.getPluginConfig = async (...args) => {
		assert(acknowledged, "counting command acknowledges before database work");
		return getConfig(...args);
	};
	await cmd.execute({
		guildId: GUILD,
		options: {
			getSubcommand: () => "channel",
			getChannel: () => ({ id: CHAN, toString: () => `#${CHAN}` }),
		},
		reply: async (p) => replies.push(p),
		deferReply: async () => { acknowledged = true; },
		editReply: async (p) => replies.push(p),
	});
	ctx.db.getPluginConfig = getConfig;
	assert((await getData()).channelId === CHAN, "channel subcommand sets channelId");

	// --- correct number advances the count ---
	const m1 = fakeMessage({ id: "A", content: "1" });
	await emitEvent("messageCreate", m1);
	let d = await getData();
	assert(d.count === 1, "correct '1' advances count to 1");
	assert(d.lastUserId === "A", "lastUserId recorded");
	assert(m1._calls.reacted.includes("✅"), "valid count reacts ✅");
	assert(d.totalCounted === 1, "totalCounted incremented");
	let u = await getUser("A");
	assert(u.correct === 1 && u.fails === 0, "userStats: correct count increments correct");
	assert(u.highest === 1, "userStats: highest tracks first count");
	assert(u.lastCountedAt instanceof Date, "userStats: lastCountedAt set");

	// --- same user twice is blocked, count unchanged ---
	const m2 = fakeMessage({ id: "A", content: "2" });
	await emitEvent("messageCreate", m2);
	d = await getData();
	assert(d.count === 1, "same user twice does not advance count");
	assert(m2._calls.deleted === true, "same-user message deleted");
	assert(m2._calls.reacted.length === 0, "same-user message not reacted");
	u = await getUser("A");
	assert(u.fails === 1 && u.correct === 1, "userStats: duplicate user increments fails");

	// --- different user with correct number advances ---
	const m3 = fakeMessage({ id: "B", content: "2" });
	await emitEvent("messageCreate", m3);
	d = await getData();
	assert(d.count === 2 && d.lastUserId === "B", "different user advances to 2");

	// --- wrong number resets (resetOnFail default true) ---
	const m4 = fakeMessage({ id: "A", content: "9" }); // expected 3
	await emitEvent("messageCreate", m4);
	d = await getData();
	assert(d.count === 0, "wrong number resets count to 0");
	assert(d.resets === 1, "resets counter incremented");
	assert(d.lastUserId === null, "lastUserId cleared on reset");
	assert(m4._calls.sent.length === 1, "reset announces failure in channel");
	assert(m4._calls.deleted === true, "wrong-number message deleted");
	u = await getUser("A");
	assert(u.fails === 2 && u.correct === 1, "userStats: wrong number increments fails");

	// --- non-numeric message is deleted, no state change ---
	const m5 = fakeMessage({ id: "A", content: "hello" });
	await emitEvent("messageCreate", m5);
	d = await getData();
	assert(d.count === 0 && m5._calls.deleted === true, "non-number deleted, count untouched");

	// --- bot message ignored entirely ---
	const m6 = fakeMessage({ id: "bot", bot: true, content: "1" });
	await emitEvent("messageCreate", m6);
	d = await getData();
	assert(d.count === 0 && m6._calls.deleted === false, "bot message ignored");

	// --- message in a different channel ignored ---
	const m7 = fakeMessage({ id: "A", content: "1", channelId: "other-chan" });
	await emitEvent("messageCreate", m7);
	d = await getData();
	assert(d.count === 0 && m7._calls.deleted === false, "wrong-channel message ignored");

	// --- climb to a milestone (10) alternating users, check announce + highest ---
	// count is 0, lastUserId null. Start fresh from 1.
	const users = ["A", "B"];
	let milestoneAnnounced = false;
	for (let n = 1; n <= 10; n++) {
		const m = fakeMessage({ id: users[n % 2], content: String(n) });
		await emitEvent("messageCreate", m);
		if (n === 10 && m._calls.sent.length > 0) milestoneAnnounced = true;
	}
	d = await getData();
	assert(d.count === 10, "climbed to 10");
	assert(d.highestCount === 10, "highestCount tracks the peak");
	assert(milestoneAnnounced === true, "milestone 10 announced");

	// --- userStats final state across the full climb ---
	// A: initial "1" + even climb numbers (2,4,6,8,10) = 6 correct, 2 fails (dup + wrong), peak 10.
	// B: "2" after A's dup + odd climb numbers (1,3,5,7,9) = 6 correct, peak 9.
	u = await getUser("A");
	const ub = await getUser("B");
	assert(u.correct === 6 && u.fails === 2 && u.highest === 10, "userStats: user A totals (6 correct, 2 fails, peak 10)");
	assert(ub.correct === 6 && ub.fails === 0 && ub.highest === 9, "userStats: user B totals (6 correct, 0 fails, peak 9)");

	// Parallel gateway events must observe the previous event's saved state.
	await Model.updateOne({ guildId: GUILD }, { count: 0, lastUserId: null });
	const rapid = [1, 2, 3, 4].map((n) => fakeMessage({ id: users[n % 2], content: String(n) }));
	await Promise.all(rapid.map((message) => emitEvent("messageCreate", message)));
	d = await getData();
	assert(d.count === 4 && rapid.every((m) => m._calls.reacted.length === 1), "parallel counts preserve arrival order without false resets");

	await Model.updateOne({ guildId: GUILD }, { count: 0, lastUserId: null });
	await ctx.db.updatePluginConfig(GUILD, "adb-plugin-counting", { resetOnFail: false, milestones: "2,4" });
	await emitEvent("messageCreate", fakeMessage({ id: "A", content: "1" }));
	const customMilestone = fakeMessage({ id: "B", content: "2" });
	await emitEvent("messageCreate", customMilestone);
	assert(customMilestone._calls.sent.length === 1, "configured comma-separated milestone is announced");
	await emitEvent("messageCreate", fakeMessage({ id: "A", content: "42" }));
	assert((await getData()).count === 2, "resetOnFail=false preserves the current count");

	await ctx.db.updatePluginConfig(GUILD, "adb-plugin-counting", { milestones: "10" });
	await Model.updateOne({ guildId: GUILD }, { count: 9, lastUserId: "B" });
	const errors = [];
	ctx.logger.error = (...args) => errors.push(args);
	const sendFailure = fakeMessage({ id: "A", content: "10" });
	sendFailure.channel.send = async () => { throw new Error("Discord unavailable"); };
	await emitEvent("messageCreate", sendFailure).catch(() => {});
	assert((await getData()).count === 10, "failed milestone send does not roll back an accepted count");
	await emitEvent("messageCreate", fakeMessage({ id: "B", content: "11" }));
	assert((await getData()).count === 11, "later events still run after a Discord failure");

	await ctx.db.updatePluginConfig(GUILD, "adb-plugin-counting", { channel: "dashboard-channel", milestones: "", resetOnFail: false });
	const dashboardMessage = fakeMessage({ id: "A", content: "12", channelId: "dashboard-channel" });
	await emitEvent("messageCreate", dashboardMessage);
	assert((await getData()).count === 12, "dashboard channel setting is used by the registered event");
	await cmd.execute({
		guildId: GUILD,
		options: { getSubcommand: () => "channel", getChannel: () => ({ id: CHAN }) },
		reply: async () => {},
		deferReply: async () => {},
		editReply: async () => {},
	});
	const commandConfig = (await ctx.db.getPluginConfig(GUILD, "adb-plugin-counting")).data;
	assert(commandConfig.channel === CHAN && commandConfig.resetOnFail === false, "channel command updates dashboard config without erasing other settings");
	await ctx.db.updatePluginConfig("fresh-guild", "adb-plugin-counting", { channel: "dashboard-only" });
	await emitEvent("messageCreate", fakeMessage({ guildId: "fresh-guild", channelId: "dashboard-only", content: "1" }));
	assert((await Model.findOne({ guildId: "fresh-guild" }))?.count === 1, "dashboard-only setup initializes real schema defaults on first count");
	await ctx.db.updatePluginConfig(GUILD, "adb-plugin-counting", { channel: CHAN, resetOnFail: true });
	const unsafe = fakeMessage({ content: "9007199254740992" });
	await emitEvent("messageCreate", unsafe);
	assert(unsafe._calls.deleted && (await getData()).count === 12, "unsafe integer text cannot corrupt or reset the count");
	assert(errors.length === 1, "Discord failure is logged once without abandoning later messages");

	await ctx.db.updatePluginConfig(GUILD, "adb-plugin-counting", { channel: null });
	const clearedChannel = fakeMessage({ id: "B", content: "13" });
	await emitEvent("messageCreate", clearedChannel);
	assert((await getData()).count === 12 && !clearedChannel._calls.deleted && clearedChannel._calls.reacted.length === 0, "clearing the dashboard channel with null does not reactivate the legacy channel");
	await Model.updateOne({ guildId: GUILD }, { count: 12, lastUserId: "A" });
	await ctx.db.updatePluginConfig(GUILD, "adb-plugin-counting", {});
	await emitEvent("messageCreate", fakeMessage({ id: "B", content: "13" }));
	assert((await getData()).count === 13, "an absent dashboard channel still uses the legacy channel");

	console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
	process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
	console.error("Harness crashed:", err);
	process.exit(1);
});
