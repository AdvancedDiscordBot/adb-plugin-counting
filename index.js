const { createCountingCommand } = require("./commands/counting");
const countingSchema = require("./models/counting");

function getDefaultConfig() {
	return {
		resetOnFail: true,
		milestones: [10, 25, 50, 100, 250, 500, 1000],
	};
}

async function load(ctx) {
	const CountingModel = ctx.defineModel("counting", countingSchema);

	ctx.registerCommand(createCountingCommand(CountingModel));

	// Listen for messages in the counting channel
	ctx.registerEvent("messageCreate", async (message, client) => {
		if (message.author.bot) return;
		if (!message.guild) return;

		const data = await CountingModel.findOne({ guildId: message.guildId });
		if (!data || !data.channelId) return;
		if (message.channelId !== data.channelId) return;

		const cfg = getDefaultConfig();

		// Parse the number
		const trimmed = message.content.trim();
		const num = parseInt(trimmed, 10);
		if (isNaN(num) || String(num) !== trimmed) {
			// Not a valid number — delete if it's not the bot
			try { await message.delete(); } catch {}
			return;
		}

		// Must be exactly the next number
		const expected = data.count + 1;

		if (num !== expected) {
			if (cfg.resetOnFail) {
				data.count = 0;
				data.resets += 1;
				data.lastUserId = null;
				await data.save();
				const failMsg = await message.channel.send(
					`❌ ${message.author} ruined it at **${expected}**! Expected **${expected}**, got **${num}**. Count reset to **0**.`
				);
				// Auto-delete the failure message after 5s
				setTimeout(() => failMsg.delete().catch(() => {}), 5000);
			}
			try { await message.delete(); } catch {}
			return;
		}

		// Must not be the same person twice
		if (data.lastUserId === message.author.id) {
			try { await message.delete(); } catch {}
			const warnMsg = await message.channel.send(
				`${message.author}, you can't count twice in a row! Count stays at **${data.count}**.`
			);
			setTimeout(() => warnMsg.delete().catch(() => {}), 3000);
			return;
		}

		// Valid count!
		data.count = num;
		data.lastUserId = message.author.id;
		data.totalCounted += 1;

		if (num > data.highestCount) {
			data.highestCount = num;
		}

		// Check milestones
		const milestones = cfg.milestones;
		if (milestones.includes(num)) {
			const emojis = ["🎉", "🔥", "⭐", "💯", "🏆", "👏"];
			const emoji = emojis[Math.floor(Math.random() * emojis.length)];
			const milestoneMsg = await message.channel.send(
				`${emoji} **${num}** — ${message.author} hit a milestone!`
			);
			setTimeout(() => milestoneMsg.delete().catch(() => {}), 5000);
		}

		// React to valid count
		try {
			await message.react("✅");
		} catch {}

		await data.save();
	});

	ctx.logger.info("Counting plugin loaded");
}

module.exports = { load };
