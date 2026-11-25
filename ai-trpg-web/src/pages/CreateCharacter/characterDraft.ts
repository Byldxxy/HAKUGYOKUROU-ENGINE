import type { Skill } from '../../domain/types';

export type CharacterDraft = {
  version: 1;
  activeTab: string;
  basicInfo: Record<string, string | number> & { name: string };
  avatar: string | null;
  statMode: 'buy' | 'roll';
  buyLimit: number;
  stats: Record<string, number>;
  skills: Skill[];
  bgInfo: Record<string, string>;
  occupationSkillChoices: Record<string, string[]>;
  choiceDrafts: Record<string, string>;
  choiceSubtypeDrafts: Record<string, string>;
  choiceCustomSubtypeDrafts: Record<string, string>;
  occupationSearch: string;
  selectedOccupationId: number;
  occupationSortMode: 'id' | 'points';
};

export function readCharacterDraft(key: string): CharacterDraft | undefined {
  try {
    const text = localStorage.getItem(key);
    if (!text) return;
    const draft = JSON.parse(text);
    if (draft?.version === 1 && typeof draft.basicInfo?.name === 'string' &&
        ['basic','skills','background','occupations'].includes(draft.activeTab) &&
        draft.stats && Array.isArray(draft.skills) && draft.skills.every((s: Skill) => typeof s?.name === 'string')) {
      return draft;
    }
  } catch { /* An unavailable or outdated draft leaves the saved character intact. */ }
}
