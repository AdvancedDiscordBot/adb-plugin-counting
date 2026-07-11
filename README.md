# adb-plugin-counting

Number counting game for your Discord server. Members take turns counting up one at a time. Wrong numbers or double-posting resets the count.

## How it works

1. An admin sets a counting channel with `/counting channel #channel`
2. Members type the next number in sequence (1, 2, 3...)
3. Wrong number → count resets. Same person twice in a row → blocked
4. Milestone messages at key numbers (10, 25, 50, 100, 250, 500, 1000)

## Commands (Admin)

- `/counting channel <channel>` — Set the counting channel
- `/counting stats` — Show server counting stats
- `/counting reset` — Reset count back to 0

## Config

| Key | Default | Description |
|-----|---------|-------------|
| `channel` | — | Channel ID |
| `resetOnFail` | true | Reset to 0 on wrong count |
| `milestones` | `10,25,50,100,250,500,1000` | Milestone numbers |

## License

This project is licensed under the **GNU Affero General Public License v3.0**. See the [LICENSE](LICENSE) file for details.

This repository follows the policies of the main ADB project.

- **Contribution Guidelines**: [CONTRIBUTING.md](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot/blob/main/CONTRIBUTING.md)
- **Code of Conduct**: [CODE_OF_CONDUCT.md](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot/blob/main/CODE_OF_CONDUCT.md)
- **Security Policy**: [SECURITY.md](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot/blob/main/SECURITY.md)
