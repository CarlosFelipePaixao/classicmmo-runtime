#ifndef CLASSICMMO_NETWORK_CLIENT_H
#define CLASSICMMO_NETWORK_CLIENT_H

#include <ixwebsocket/IXWebSocket.h>

#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace classicmmo {

struct RemotePlayerState {
	std::string client_id;
	std::string map_id;
	int x = 0;
	int y = 0;
	std::string direction = "down";
};

class NetworkClient {
public:
	NetworkClient();
	~NetworkClient();

	bool Connect(const std::string& server_url);
	void Disconnect();

	bool IsConnected() const;

	void SendChat(const std::string& text);

	void SendPosition(
		const std::string& map_id,
		int x,
		int y,
		const std::string& direction
	);

	std::vector<RemotePlayerState> GetRemotePlayersSnapshot() const;

	void Update();

private:
	void HandleServerMessage(const std::string& raw_message);
	void ApplyStateSnapshot(const std::vector<RemotePlayerState>& players);
	void UpsertRemotePlayer(const RemotePlayerState& player);
	void RemoveRemotePlayer(const std::string& client_id);

	std::unique_ptr<ix::WebSocket> socket;
	std::atomic_bool connected{false};
	std::string url;

	mutable std::mutex remote_players_mutex;
	std::unordered_map<std::string, RemotePlayerState> remote_players;
};

} // namespace classicmmo

#endif