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
function fakeMessage({ id = "userA", bot = false, content, channelId = CHAN }) {
	const calls = { deleted: false, reacted: [], sent: [] };
	const author = { bot, id, toString: () => `<@${id}>` };
	return {
		author,
		guild: { id: GUILD },
		guildId: GUILD,
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
	const getData = () => Model.findOne({ guildId: GUILD });

	// Seed the counting channel via the /counting channel subcommand (bot-faithful).
	const cmd = registeredCommands.get("counting");
	const replies = [];
	await cmd.execute({
		guildId: GUILD,
		options: {
			getSubcommand: () => "channel",
			getChannel: () => ({ id: CHAN, toString: () => `#${CHAN}` }),
		},
		reply: async (p) => replies.push(p),
	});
	assert((await getData()).channelId === CHAN, "channel subcommand sets channelId");

	// --- correct number advances the count ---
	const m1 = fakeMessage({ id: "A", content: "1" });
	await emitEvent("messageCreate", m1);
	let d = await getData();
	assert(d.count === 1, "correct '1' advances count to 1");
	assert(d.lastUserId === "A", "lastUserId recorded");
	assert(m1._calls.reacted.includes("✅"), "valid count reacts ✅");
	assert(d.totalCounted === 1, "totalCounted incremented");

	// --- same user twice is blocked, count unchanged ---
	const m2 = fakeMessage({ id: "A", content: "2" });
	await emitEvent("messageCreate", m2);
	d = await getData();
	assert(d.count === 1, "same user twice does not advance count");
	assert(m2._calls.deleted === true, "same-user message deleted");
	assert(m2._calls.reacted.length === 0, "same-user message not reacted");

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

	console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
	process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
	console.error("Harness crashed:", err);
	process.exit(1);
});
