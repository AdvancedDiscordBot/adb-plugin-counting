function createCountingCommand(CountingModel) {
	return {
		data: {
			name: "counting",
			description: "Configure and view counting game stats",
			defaultMemberPermissions: "ManageChannels",
			options: [
				{
					name: "channel",
					description: "Set the counting channel",
					type: 1,
					options: [
						{
							name: "channel",
							type: 7,
							description: "Text channel",
							required: true,
						},
					],
				},
				{
					name: "stats",
					description: "Show counting stats for this server",
					type: 1,
				},
				{
					name: "reset",
					description: "Reset the count back to 0",
					type: 1,
				},
			],
		},
		async execute(interaction) {
			const sub = interaction.options.getSubcommand();
			const guildId = interaction.guildId;

			if (sub === "channel") {
				const channel = interaction.options.getChannel("channel");
				await CountingModel.findOneAndUpdate(
					{ guildId },
					{ channelId: channel.id },
					{ upsert: true }
				);
				return interaction.reply({ content: `Counting channel set to ${channel}.`, ephemeral: true });
			}

			if (sub === "stats") {
				const data = await CountingModel.findOne({ guildId });
				if (!data) {
					return interaction.reply({ content: "No counting data yet.", ephemeral: true });
				}
				return interaction.reply({
					content: [
						`📊 **Counting Stats**`,
						`Current: **${data.count}**`,
						`Highest: **${data.highestCount}**`,
						`Total numbers counted: **${data.totalCounted}**`,
						`Resets: **${data.resets}**`,
					].join("\n"),
					ephemeral: true,
				});
			}

			if (sub === "reset") {
				await CountingModel.findOneAndUpdate(
					{ guildId },
					{ count: 0, lastUserId: null },
					{ upsert: true }
				);
				return interaction.reply({ content: "Count reset to 0.", ephemeral: true });
			}
		},
	};
}

module.exports = { createCountingCommand };
