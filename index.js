const { createCountingCommand } = require("./commands/counting");
const countingSchema = require("./models/counting");
const userStatsSchema = require("./models/userStats");

async function load(ctx) {
	const CountingModel = ctx.defineModel("counting", countingSchema);
	const UserStatsModel = ctx.defineModel("userStats", userStatsSchema);
	const pending = new Map();

	// Gateway events and admin resets must observe the preceding saved count.
	async function inOrder(guildId, work) {
		const task = (pending.get(guildId) || Promise.resolve()).catch(() => {}).then(work);
		pending.set(guildId, task);
		try {
			return await task;
		} finally {
			if (pending.get(guildId) === task) pending.delete(guildId);
		}
	}
	const command = createCountingCommand(CountingModel, ctx.db);
	ctx.registerCommand({
		...command,
		async execute(interaction) {
			await interaction.deferReply({ ephemeral: true });
			try {
				return await inOrder(interaction.guildId, () => command.execute(interaction));
			} catch (error) {
				ctx.logger.error("Failed to manage counting", error);
				return interaction.editReply({ content: "Unable to update or read counting data. Try again later." });
			}
		},
	});

	// Listen for messages in the counting channel
	ctx.registerEvent("messageCreate", async (message) => {
		if (message.author.bot) return;
		if (!message.guild) return;
		try {
			await inOrder(message.guildId, () => countMessage(message));
		} catch (error) {
			ctx.logger.error("Failed to process counting message", error);
		}
	});

	async function countMessage(message) {
		const cfg = (await ctx.db.getPluginConfig(message.guildId, "adb-plugin-counting"))?.data || {};
		let data = await CountingModel.findOne({ guildId: message.guildId });
		const channelId = cfg.channel === undefined ? data?.channelId : cfg.channel;
		if (!channelId || message.channelId !== channelId) return;
		if (!data) {
			data = await CountingModel.findOneAndUpdate(
				{ guildId: message.guildId },
				{ $setOnInsert: { channelId } },
				{ upsert: true, new: true }
			);
		}

		// Parse the number
		const trimmed = message.content.trim();
		const num = parseInt(trimmed, 10);
		if (!Number.isSafeInteger(num) || String(num) !== trimmed) {
			// Not a valid number — delete if it's not the bot
			try { await message.delete(); } catch {}
			return;
		}

		const userQuery = { guildId: message.guildId, userId: message.author.id };

		// Must be exactly the next number
		const expected = data.count + 1;

		if (num !== expected) {
			await UserStatsModel.findOneAndUpdate(userQuery, { $inc: { fails: 1 } }, { upsert: true });
			if (cfg.resetOnFail ?? true) {
				data.count = 0;
				data.resets += 1;
				data.lastUserId = null;
				await data.save();
				const failMsg = await message.channel.send(
					`❌ ${message.author} ruined it at **${expected}**! Expected **${expected}**, got **${num}**. Count reset to **0**.`
				);
				// Auto-delete the failure message after 5s
				setTimeout(() => failMsg.delete().catch(() => {}), 5000).unref();
			}
			try { await message.delete(); } catch {}
			return;
		}

		// Must not be the same person twice
		if (data.lastUserId === message.author.id) {
			await UserStatsModel.findOneAndUpdate(userQuery, { $inc: { fails: 1 } }, { upsert: true });
			try { await message.delete(); } catch {}
			const warnMsg = await message.channel.send(
				`${message.author}, you can't count twice in a row! Count stays at **${data.count}**.`
			);
			setTimeout(() => warnMsg.delete().catch(() => {}), 3000).unref();
			return;
		}

		// Valid count!
		data.count = num;
		data.lastUserId = message.author.id;
		data.totalCounted += 1;

		await UserStatsModel.updateOne(
			userQuery,
			{ $inc: { correct: 1 }, $max: { highest: num }, $set: { lastCountedAt: new Date() } },
			{ upsert: true }
		);

		if (num > data.highestCount) {
			data.highestCount = num;
		}
		await data.save();

		// Check milestones
		const milestones = (typeof cfg.milestones === "string" ? cfg.milestones : "10,25,50,100,250,500,1000")
			.split(",").map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
		if (milestones.includes(num)) {
			const emojis = ["🎉", "🔥", "⭐", "💯", "🏆", "👏"];
			const emoji = emojis[Math.floor(Math.random() * emojis.length)];
			const milestoneMsg = await message.channel.send(
				`${emoji} **${num}** — ${message.author} hit a milestone!`
			);
			setTimeout(() => milestoneMsg.delete().catch(() => {}), 5000).unref();
		}

		// React to valid count
		try {
			await message.react("✅");
		} catch {}
	}

	ctx.logger.info("Counting plugin loaded");
}

module.exports = { load };
