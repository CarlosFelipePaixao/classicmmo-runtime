#ifndef CLASSICMMO_NETWORK_MESSAGE_H
#define CLASSICMMO_NETWORK_MESSAGE_H

#include <string>

namespace classicmmo {

struct RemotePosition {
	int x = 0;
	int y = 0;
	std::string map_id = "test_map";
	std::string direction = "down";
	std::string from;
};

class NetworkMessage {
public:
	static std::string MakeChatMessage(const std::string& text);

	static std::string MakePositionMessage(
		const std::string& map_id,
		int x,
		int y,
		const std::string& direction
	);

	static bool TryGetType(const std::string& raw_json, std::string& out_type);

	static bool TryParsePosition(
		const std::string& raw_json,
		RemotePosition& out_position
	);
};

} // namespace classicmmo

#endif