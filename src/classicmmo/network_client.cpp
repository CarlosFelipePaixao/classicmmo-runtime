#include "network_client.h"

#include "network_message.h"

#include <iostream>

namespace classicmmo {

NetworkClient::NetworkClient() = default;

bool NetworkClient::Connect(const std::string& server_url) {
	url = server_url;
	connected = true;

	std::cout << "[ClassicMMO] Pretending to connect to " << url << std::endl;

	return connected;
}

void NetworkClient::Disconnect() {
	if (!connected) {
		return;
	}

	std::cout << "[ClassicMMO] Disconnecting from " << url << std::endl;

	connected = false;
	url.clear();
}

bool NetworkClient::IsConnected() const {
	return connected;
}

void NetworkClient::SendChat(const std::string& text) {
	if (!connected) {
		return;
	}

	const auto message = NetworkMessage::MakeChatMessage(text);

	std::cout << "[ClassicMMO] Send chat: " << message << std::endl;
}

void NetworkClient::SendPosition(
	const std::string& map_id,
	int x,
	int y,
	const std::string& direction
) {
	if (!connected) {
		return;
	}

	const auto message = NetworkMessage::MakePositionMessage(
		map_id,
		x,
		y,
		direction
	);

	std::cout << "[ClassicMMO] Send position: " << message << std::endl;
}

void NetworkClient::Update() {
	if (!connected) {
		return;
	}

	// Future: poll websocket events here.
}

} // namespace classicmmo