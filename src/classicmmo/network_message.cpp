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
                const auto message = json::parse(raw_json, nullptr, false);

                if (message.is_discarded())
                {
                        return false;
                }

                if (!message.contains("type") || !message["type"].is_string())
                {
                        return false;
                }

                out_type = message["type"].get<std::string>();
                return true;
        }

        bool NetworkMessage::TryParsePosition(
                const std::string &raw_json,
                RemotePosition &out_position)
        {
                const auto message = json::parse(raw_json, nullptr, false);

                if (message.is_discarded())
                {
                        return false;
                }

                if (!message.contains("type") || !message["type"].is_string())
                {
                        return false;
                }

                if (message["type"].get<std::string>() != "position")
                {
                        return false;
                }

                out_position.from = message.contains("from") && message["from"].is_string()
                        ? message["from"].get<std::string>()
                        : "";

                out_position.map_id = message.contains("mapId") && message["mapId"].is_string()
                        ? message["mapId"].get<std::string>()
                        : "test_map";

                out_position.x = message.contains("x") && message["x"].is_number_integer()
                        ? message["x"].get<int>()
                        : 0;

                out_position.y = message.contains("y") && message["y"].is_number_integer()
                        ? message["y"].get<int>()
                        : 0;

                out_position.direction = message.contains("direction") && message["direction"].is_string()
                        ? message["direction"].get<std::string>()
                        : "down";

                out_position.sprite_name = message.contains("spriteName") && message["spriteName"].is_string()
                        ? message["spriteName"].get<std::string>()
                        : "";

                out_position.sprite_index = message.contains("spriteIndex") && message["spriteIndex"].is_number_integer()
                        ? message["spriteIndex"].get<int>()
                        : 0;

                out_position.player_name = message.contains("playerName") && message["playerName"].is_string()
                        ? message["playerName"].get<std::string>()
                        : "";

                return true;
        }

} // namespace classicmmo
