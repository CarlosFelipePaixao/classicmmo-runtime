#include "remote_character.h"

namespace classicmmo {

RemoteCharacter::RemoteCharacter() :
	RemoteCharacterBase(Game_Character::Event)
{
	SetThrough(true);
	SetLayer(lcf::rpg::EventPage::Layers_same);
	SetSpriteHidden(false);
}

void RemoteCharacter::ApplyNetworkState(
	int map_id,
	int x,
	int y,
	int direction,
	const std::string& sprite_name,
	int sprite_index
) {
	SetMapId(map_id);
	SetX(x);
	SetY(y);
	SetDirection(direction);
	SetFacing(direction);
	SetThrough(true);

	if (!sprite_name.empty()) {
		SetSpriteGraphic(sprite_name, sprite_index);
	}
}

void RemoteCharacter::UpdateNextMovementAction() {
	// Remote characters are driven by network state, not local movement AI.
}

} // namespace classicmmo