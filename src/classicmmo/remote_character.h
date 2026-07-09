#ifndef CLASSICMMO_REMOTE_CHARACTER_H
#define CLASSICMMO_REMOTE_CHARACTER_H

#include "game_character.h"

#include <lcf/rpg/savemapeventbase.h>

#include <string>

namespace classicmmo {

using RemoteCharacterBase = Game_CharacterDataStorage<lcf::rpg::SaveMapEventBase>;

class RemoteCharacter final : public RemoteCharacterBase {
public:
	RemoteCharacter();

	void ApplyNetworkState(
		int map_id,
		int x,
		int y,
		int direction,
		const std::string& sprite_name,
		int sprite_index
	);

	void UpdateNextMovementAction() override;
};

} // namespace classicmmo

#endif