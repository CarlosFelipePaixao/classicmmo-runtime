#include "network_client.h"

#include "network_message.h"

#include <fstream>
#include <iostream>
#include <nlohmann/json.hpp>

namespace classicmmo {
namespace {

using json = nlohmann::json;

std::mutex g_log_mutex;

void ClassicLog(const std::string& message) {
	std::lock_guard<std::mutex> lock(g_log_mutex);

	std::cout << message << std::endl;

	std::ofstream file("classicmmo_network.log", std::ios::app);
	if (file) {
		file << message << std::endl;
	}
}

std::string NormalizeDirection(const std::string& direction) {
	if (
		direction == "up" ||
		direction == "down" ||
		direction == "left" ||
		direction == "right"
	) {
		return direction;
	}

	return "down";
}

bool ReadRemotePlayerFromJson(
	const json& message,
	const std::string& client_id_key,
	RemotePlayerState& out_player
) {
	if (!message.is_object()) {
		return false;
	}

	const std::string client_id = message.value(client_id_key, "");
	const std::string map_id = message.value("mapId", "");

	if (client_id.empty() || map_id.empty()) {
		return false;
	}

	out_player.client_id = client_id;
	out_player.map_id = map_id;
	out_player.x = message.value("x", 0);
	out_player.y = message.value("y", 0);
	out_player.direction = NormalizeDirection(message.value("direction", "down"));

	return true;
}

} // namespace

NetworkClient::NetworkClient() = default;

NetworkClient::~NetworkClient() {
	Disconnect();
}

bool NetworkClient::Connect(const std::string& server_url) {
	if (connected.load()) {
		return true;
	}

	url = server_url;
	socket = std::make_unique<ix::WebSocket>();
	socket->setUrl(url);

	socket->setOnMessageCallback([this](const ix::WebSocketMessagePtr& msg) {
		if (msg->type == ix::WebSocketMessageType::Open) {
			connected.store(true);
			ClassicLog("[ClassicMMO] Connected to " + url);
			return;
		}

		if (msg->type == ix::WebSocketMessageType::Close) {
			connected.store(false);
			ClassicLog("[ClassicMMO] Connection closed");
			return;
		}

		if (msg->type == ix::WebSocketMessageType::Error) {
			connected.store(false);
			ClassicLog("[ClassicMMO] WebSocket error: " + msg->errorInfo.reason);
			return;
		}

		if (msg->type == ix::WebSocketMessageType::Message) {
			HandleServerMessage(msg->str);
		}
	});

	socket->start();

	ClassicLog("[ClassicMMO] Connecting to " + url);

	return true;
}

void NetworkClient::Disconnect() {
	if (socket) {
		socket->stop();
		socket.reset();
	}

	if (connected.load()) {
		ClassicLog("[ClassicMMO] Disconnected from " + url);
	}

	connected.store(false);
	url.clear();

	{
		std::lock_guard<std::mutex> lock(remote_players_mutex);
		remote_players.clear();
	}
}

bool NetworkClient::IsConnected() const {
	return connected.load();
}

void NetworkClient::SendChat(const std::string& text) {
	if (!socket || !connected.load()) {
		return;
	}

	const auto message = NetworkMessage::MakeChatMessage(text);
	socket->sendText(message);

	ClassicLog("[ClassicMMO] Send chat: " + message);
}

void NetworkClient::SendPosition(
	const std::string& map_id,
	int x,
	int y,
	const std::string& direction
) {
	if (!socket || !connected.load()) {
		return;
	}

	const auto message = NetworkMessage::MakePositionMessage(
		map_id,
		x,
		y,
		direction
	);

	socket->sendText(message);

	ClassicLog("[ClassicMMO] Send position: " + message);
}

std::vector<RemotePlayerState> NetworkClient::GetRemotePlayersSnapshot() const {
	std::lock_guard<std::mutex> lock(remote_players_mutex);

	std::vector<RemotePlayerState> snapshot;
	snapshot.reserve(remote_players.size());

	for (const auto& entry : remote_players) {
		snapshot.push_back(entry.second);
	}

	return snapshot;
}

void NetworkClient::HandleServerMessage(const std::string& raw_message) {
	json message;

	try {
		message = json::parse(raw_message);
	} catch (const std::exception& e) {
		ClassicLog(std::string("[ClassicMMO] Invalid server JSON: ") + e.what());
		return;
	}

	const std::string type = message.value("type", "");

	if (type == "welcome") {
		ClassicLog("[ClassicMMO] Received welcome: " + raw_message);
		return;
	}

	if (type == "state_snapshot") {
		std::vector<RemotePlayerState> players;

		if (message.contains("players") && message["players"].is_array()) {
			for (const auto& player_json : message["players"]) {
				RemotePlayerState player;

				if (ReadRemotePlayerFromJson(player_json, "clientId", player)) {
					players.push_back(player);
				}
			}
		}

		ApplyStateSnapshot(players);

		ClassicLog(
			"[ClassicMMO] Applied state snapshot. Remote players: " +
			std::to_string(players.size())
		);

		return;
	}

	if (type == "player_joined") {
		RemotePlayerState player;

		if (ReadRemotePlayerFromJson(message, "clientId", player)) {
			UpsertRemotePlayer(player);

			ClassicLog(
				"[ClassicMMO] Remote player joined: " +
				player.client_id +
				" map=" + player.map_id +
				" x=" + std::to_string(player.x) +
				" y=" + std::to_string(player.y) +
				" dir=" + player.direction
			);
		} else {
			ClassicLog("[ClassicMMO] Invalid player_joined message: " + raw_message);
		}

		return;
	}

	if (type == "position") {
		RemotePlayerState player;

		if (ReadRemotePlayerFromJson(message, "from", player)) {
			UpsertRemotePlayer(player);

			ClassicLog(
				"[ClassicMMO] Remote position: " +
				player.client_id +
				" map=" + player.map_id +
				" x=" + std::to_string(player.x) +
				" y=" + std::to_string(player.y) +
				" dir=" + player.direction
			);
		} else {
			ClassicLog("[ClassicMMO] Invalid position message: " + raw_message);
		}

		return;
	}

	if (type == "player_left") {
		const std::string client_id = message.value("clientId", "");

		if (!client_id.empty()) {
			RemoveRemotePlayer(client_id);
			ClassicLog("[ClassicMMO] Remote player left: " + client_id);
		}

		return;
	}

	if (type == "chat") {
		ClassicLog("[ClassicMMO] Received chat: " + raw_message);
		return;
	}

	if (type == "error") {
		ClassicLog("[ClassicMMO] Server error: " + raw_message);
		return;
	}

	ClassicLog("[ClassicMMO] Unknown server message: " + raw_message);
}

void NetworkClient::ApplyStateSnapshot(const std::vector<RemotePlayerState>& players) {
	std::lock_guard<std::mutex> lock(remote_players_mutex);

	remote_players.clear();

	for (const auto& player : players) {
		remote_players[player.client_id] = player;
	}
}

void NetworkClient::UpsertRemotePlayer(const RemotePlayerState& player) {
	std::lock_guard<std::mutex> lock(remote_players_mutex);

	remote_players[player.client_id] = player;
}

void NetworkClient::RemoveRemotePlayer(const std::string& client_id) {
	std::lock_guard<std::mutex> lock(remote_players_mutex);

	remote_players.erase(client_id);
}

void NetworkClient::Update() {
	// IXWebSocket runs callbacks on its own internal thread.
	// Future: use GetRemotePlayersSnapshot() from the game/rendering layer.
}

} // namespace classicmmo