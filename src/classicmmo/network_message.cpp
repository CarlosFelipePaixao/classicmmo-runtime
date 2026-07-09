#include "network_message.h"

#include <nlohmann/json.hpp>

namespace classicmmo
{

	using json = nlohmann::json;

	std::string NetworkMessage::MakeChatMessage(const std::string &text)
	{
		json message;

		message["type"] = "chat";
		message["text"] = text;

		return message.dump();
	}

	std::string NetworkMessage::MakePositionMessage(
		const std::string &map_id,
		int x,
		int y,
		const std::string &direction,
		const std::string &sprite_name,
		int sprite_index,
		const std::string &player_name)
	{
		json message;

		message["type"] = "position";
		message["mapId"] = map_id;
		message["x"] = x;
		message["y"] = y;
		message["direction"] = direction;
		message["spriteName"] = sprite_name;
		message["spriteIndex"] = sprite_index;
		message["playerName"] = player_name;

		return message.dump();
	}

	bool NetworkMessage::TryGetType(const std::string &raw_json, std::string &out_type)
	{
		try
		{
			const auto message = json::parse(raw_json);

			if (!message.contains("type") || !message["type"].is_string())
			{
				return false;
			}

			out_type = message["type"].get<std::string>();
			return true;
		}
		catch (...)
		{
			return false;
		}
	}

	bool NetworkMessage::TryParsePosition(
		const std::string &raw_json,
		RemotePosition &out_position)
	{
		try
		{
			const auto message = json::parse(raw_json);

			if (!message.contains("type") || message["type"] != "position")
			{
				return false;
			}

			out_position.from = message.value("from", "");
			out_position.map_id = message.value("mapId", "test_map");
			out_position.x = message.value("x", 0);
			out_position.y = message.value("y", 0);
			out_position.direction = message.value("direction", "down");

			if (message.contains("spriteName") && message["spriteName"].is_string())
			{
				out_position.sprite_name = message["spriteName"].get<std::string>();
			}
			else
			{
				out_position.sprite_name.clear();
			}

			if (message.contains("spriteIndex") && message["spriteIndex"].is_number_integer())
			{
				out_position.sprite_index = message["spriteIndex"].get<int>();
			}
			else
			{
				out_position.sprite_index = 0;
			}
			if (message.contains("playerName") && message["playerName"].is_string())
			{
				out_position.player_name = message["playerName"].get<std::string>();
			}
			else
			{
				out_position.player_name.clear();
			}

			return true;
		}
		catch (...)
		{
			return false;
		}
	}

} // namespace classicmmo