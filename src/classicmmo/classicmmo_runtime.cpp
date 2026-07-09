#include "classicmmo_runtime.h"

#include "game_player.h"
#include "main_data.h"

#include <ixwebsocket/IXNetSystem.h>

#include <cstdlib>
#include <iostream>
#include <string>

namespace classicmmo
{
	namespace
	{

		NetworkClient g_network_client;
		bool g_initialized = false;

		int g_last_map_id = -1;
		int g_last_x = -1;
		int g_last_y = -1;
		int g_last_direction = -1;

		std::string DirectionToString(int direction)
		{
			switch (direction)
			{
			case 0:
				return "up";
			case 1:
				return "right";
			case 2:
				return "down";
			case 3:
				return "left";
			default:
				return "down";
			}
		}

		void ResetLastPlayerPosition()
		{
			g_last_map_id = -1;
			g_last_x = -1;
			g_last_y = -1;
			g_last_direction = -1;
		}

		void SendPlayerPositionIfChanged()
		{
			if (!g_network_client.IsConnected())
			{
				ResetLastPlayerPosition();
				return;
			}

			if (!Main_Data::game_player)
			{
				return;
			}

			const int map_id = Main_Data::game_player->GetMapId();

			if (map_id <= 0)
			{
				return;
			}

			const int x = Main_Data::game_player->GetX();
			const int y = Main_Data::game_player->GetY();
			const int direction = Main_Data::game_player->GetDirection();

			if (
				map_id == g_last_map_id &&
				x == g_last_x &&
				y == g_last_y &&
				direction == g_last_direction)
			{
				return;
			}

			g_last_map_id = map_id;
			g_last_x = x;
			g_last_y = y;
			g_last_direction = direction;

			g_network_client.SendPosition(
				std::to_string(map_id),
				x,
				y,
				DirectionToString(direction),
				Main_Data::game_player->GetSpriteName(),
				Main_Data::game_player->GetSpriteIndex());
		}

	} // namespace

	void ClassicMMORuntime::Initialize()
	{
		if (g_initialized)
		{
			return;
		}

		g_initialized = true;

		ix::initNetSystem();
		ResetLastPlayerPosition();

		std::cout << "[ClassicMMO] Runtime initialized" << std::endl;

		const char *server_url = std::getenv("CLASSICMMO_SERVER_URL");

		if (server_url && server_url[0] != '\0')
		{
			g_network_client.Connect(server_url);
		}
		else
		{
			std::cout << "[ClassicMMO] Network disabled. Set CLASSICMMO_SERVER_URL to connect." << std::endl;
		}
	}

	void ClassicMMORuntime::Shutdown()
	{
		if (!g_initialized)
		{
			return;
		}

		g_network_client.Disconnect();

		ix::uninitNetSystem();
		ResetLastPlayerPosition();

		g_initialized = false;

		std::cout << "[ClassicMMO] Runtime shutdown" << std::endl;
	}

	void ClassicMMORuntime::Update()
	{
		if (!g_initialized)
		{
			return;
		}

		g_network_client.Update();
		SendPlayerPositionIfChanged();
	}

	bool ClassicMMORuntime::IsInitialized()
	{
		return g_initialized;
	}

	NetworkClient &ClassicMMORuntime::GetNetworkClient()
	{
		return g_network_client;
	}

} // namespace classicmmo