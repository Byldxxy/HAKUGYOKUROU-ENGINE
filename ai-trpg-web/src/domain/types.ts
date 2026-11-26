export type Skill = { id: string; name: string; base: number; job: number; interest: number; grow: number };
export type CharacterData = {
  id?: string;
  avatar?: string | null;
  basicInfo: Record<string, string>;
  stats: Record<string, number>;
  skills: Skill[];
  bgInfo: Record<string, string>;
  statMode?: string;
  buyLimit?: number;
};
export type CharacterSummary = { id: string; name: string; role: string; hp: number; san: number; mp: number; avatarRevision?: string | null };
export type Character = CharacterSummary & { fullData: CharacterData; avatarPath?: string | null };
export type PublicPlayer = {
  fitsRoomRules?: boolean;
  offlineRoll?: boolean;
  avatarPath?: string;
  id: string | null; name: string; characterId: string | null; characterName: string | null;
  role: string; hp: number; san: number; mp: number; hpMax: number; sanMax: number; mpMax: number;
};
export type RollRules = { difficulty: 'regular' | 'hard' | 'extreme'; modifier: number; baseValue: number; target: number };
export type Message = { followingRolls?: Array<{ sender: string; rollId?: string; content: string }>; rollRules?: RollRules[]; role: string; sender: string; content: string; rollId?: string; logIndex?: number };
export type LobbyMessage = { id: number; sender: string; text: string; isSystem: boolean };
export type Save = { id: string; name: string; date: string };
export type GameCharacter = {
  avatar?: string | null;
  id: string; name: string; role: string; appearance: string;
  hp: { current: number; max: number }; san: { current: number; max: number }; mp: { current: number; max: number };
  skills: Record<string, number>;
};
