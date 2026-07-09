#ifndef CLASSICMMO_NETWORK_MESSAGE_H
#define CLASSICMMO_NETWORK_MESSAGE_H

#include <string>

namespace classicmmo
{

	struct RemotePosition
	{
		std::string player_name;
		std::string from;
		std::string map_id = "test_map";
		int x = 0;
		int y = 0;
		std::string direction = "down";
		std::string sprite_name;
		int sprite_index = 0;
	};

	class NetworkMessage
	{
	public:
		static std::string MakeChatMessage(const std::string &text);

		static std::string MakePositionMessage(
			const std::string &map_id,
			int x,
			int y,
			const std::string &direction,
			const std::string &sprite_name,
			int sprite_index,
			const std::string &player_name);

		static bool TryGetType(const std::string &raw_json, std::string &out_type);

		static bool TryParsePosition(
			const std::string &raw_json,
			RemotePosition &out_position);
	};

} // namespace classicmmo

#endif