// Korean labels for YouTube topicDetails.topicCategories (Wikipedia slugs).
export const TOPIC_LABELS: Record<string, string> = {
  Music: '음악', Christian_music: '기독교 음악', Classical_music: '클래식 음악', Country_music: '컨트리 음악',
  Electronic_music: '일렉트로닉 음악', 'Hip_hop_music': '힙합', Independent_music: '인디 음악', Jazz: '재즈',
  Music_of_Asia: '아시아 음악', Music_of_Latin_America: '라틴 아메리카 음악', Pop_music: '팝 음악', Reggae: '레게',
  Rhythm_and_blues: '알앤비', Rock_music: '록 음악', Soul_music: '소울 음악',
  Video_game_culture: '비디오 게임 문화', Action_game: '액션 게임', 'Action-adventure_game': '액션 어드벤처 게임',
  Casual_game: '캐주얼 게임', Music_video_game: '음악 게임', Puzzle_video_game: '퍼즐 게임', Racing_video_game: '레이싱 게임',
  'Role-playing_video_game': 'RPG 게임', Simulation_video_game: '시뮬레이션 게임', Sports_game: '스포츠 게임',
  Strategy_video_game: '전략 게임',
  Sport: '스포츠', American_football: '미식 축구', Association_football: '축구', Baseball: '야구', Basketball: '농구',
  Boxing: '복싱', Cricket: '크리켓', Golf: '골프', Ice_hockey: '아이스하키', Mixed_martial_arts: '격투기',
  Motorsport: '모터 스포츠', Professional_wrestling: '프로레슬링', Tennis: '테니스', Volleyball: '배구',
  Entertainment: '엔터테인먼트', Humour: '유머', Film: '영화/애니', Performing_arts: '공연 예술', Television_program: 'TV 프로그램',
  'Lifestyle_(sociology)': '라이프스타일', Fashion: '패션', Physical_fitness: '피트니스', Food: '음식', Hobby: '취미',
  Pet: '반려동물', Physical_attractiveness: '신체적 매력', Technology: '기술/테크', Tourism: '여행/관광', Vehicle: '자동차',
  Society: '사회', Business: '비즈니스', Health: '건강', Military: '군사', Politics: '정치', Religion: '종교',
  Knowledge: '지식',
};

export const UNCLASSIFIED = '__none__';

export function topicLabel(id: string) {
  if (id === UNCLASSIFIED) return '미분류';
  return TOPIC_LABELS[id] || id.replace(/_/g, ' ');
}

export const COUNTRY_OPTIONS = [
  { value: 'KR', code: 'KR', label: '한국' },
  { value: 'US', code: 'US', label: '미국' },
  { value: 'JP', code: 'JP', label: '일본' },
  { value: 'OTHER', code: '', label: '그 외' },
] as const;
