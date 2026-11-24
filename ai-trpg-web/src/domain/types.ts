export type Skill = { id: string; name: string; base: number; job: number; interest: number; grow: number };
export type CharacterData = {
  id?: string;
  basicInfo: Record<string, string>;
  stats: Record<string, number>;
  skills: Skill[];
  bgInfo: Record<string, string>;
  statMode?: string;
  buyLimit?: number;
};
export type Character = { id: string; name: string; role: string; hp: number; san: number; mp: number; fullData: CharacterData };
export type PublicPlayer = {
  id: string | null; name: string; characterId: string | null; characterName: string | null;
  role: string; hp: number; san: number; mp: number; hpMax: number; sanMax: number; mpMax: number;
};
export type Message = { role: string; sender: string; content: string; rollId?: string; logIndex?: number };
export type LobbyMessage = { id: number; sender: string; text: string; isSystem: boolean };
export type Save = { id: string; name: string; date: string };
export type GameCharacter = {
  id: string; name: string; role: string; appearance: string;
  hp: { current: number; max: number }; san: { current: number; max: number }; mp: { current: number; max: number };
  skills: Record<string, number>;
};
