import type { PluginCatalogEntry, PluginSource } from '../../shared/plugins.js';

/** Reviewed upstream recipes; versions are pinned until an explicit update. Icons are original CoS artwork. */
export const pluginCatalog: PluginCatalogEntry[] = [
  {
    id: 'blender',
    name: 'Blender MCP',
    description: '커뮤니티 Blender 애드온으로 3D 장면을 만들고 살펴봅니다.',
    icon: 'blender',
    color: '#e87932',
    source: { kind: 'python', package: 'blender-mcp', version: '1.9.1', command: 'blender-mcp' },
    homepage: 'https://github.com/ahujasid/blender-mcp',
    license: 'MIT',
    fields: [],
    tools: ['get_scene_info', 'get_object_info', 'get_viewport_screenshot', 'execute_blender_code'],
    instructions: [
      'Python 3.10 이상과 uv를 설치하세요. uv 설치 안내: https://docs.astral.sh/uv/getting-started/installation/.',
      '이 플러그인을 설치한 뒤 터미널에서 uvx blender-mcp==1.9.1 install-addon 명령을 실행하세요. 소스 저장소의 addon.py를 설치해도 됩니다.',
      'Blender에서 Preferences → Add-ons → Interface: MCP for Blender를 켜세요. 3D 뷰포트에서 N을 누르고 MCP for Blender를 연 뒤 Start MCP Server를 클릭하세요.',
      '플러그인을 다시 시작하세요. 도구 검색과 읽기 전용 장면 확인이 성공해야 준비 완료로 표시됩니다.',
    ],
  },
  {
    id: 'memory',
    name: 'Knowledge Memory',
    description: '대화의 지식 그래프를 로컬에 지속적으로 저장합니다.',
    icon: 'memory',
    color: '#9b7bd9',
    source: { kind: 'npm', package: '@modelcontextprotocol/server-memory', version: '2026.8.31' },
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    license: 'MIT / Apache-2.0; see upstream notices',
    fields: [],
    tools: ['create_entities', 'create_relations', 'add_observations', 'read_graph', 'search_nodes'],
    instructions: [
      'https://nodejs.org/에서 Node.js 20 이상을 설치하세요.',
      '기억 데이터는 별도 데이터 폴더에 저장되어 플러그인 업데이트 후에도 유지됩니다. 플러그인을 제거하면 로컬 데이터가 삭제됩니다. 노출할 도구만 활성화하세요.',
    ],
  },
  {
    id: 'playwright',
    name: 'Playwright Browser',
    description: 'Microsoft의 Playwright MCP 서버로 브라우저를 자동화합니다.',
    icon: 'playwright',
    color: '#45a66b',
    source: { kind: 'npm', package: '@playwright/mcp', version: '0.0.80' },
    homepage: 'https://github.com/microsoft/playwright-mcp',
    license: 'Apache-2.0',
    fields: [],
    tools: ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_fill_form', 'browser_tabs', 'browser_take_screenshot'],
    instructions: [
      'Node.js 20 이상과 Google Chrome을 설치하세요.',
      '이 통합은 자체 브라우저를 실행합니다. 외부 프로세스에는 현재 OS 사용자 권한이 적용됩니다.',
    ],
  },
  {
    id: 'fetch',
    name: 'Web Fetch',
    description: '웹페이지를 가져와 모델이 사용할 수 있는 내용으로 변환합니다.',
    icon: 'fetch',
    color: '#498edb',
    // This upstream release declares mcp>=1.1.3 but imports v1's McpError. Resolve
    // the reviewed SDK version with the server; unconstrained mcp2 crashes at import.
    source: { kind: 'python', package: 'mcp-server-fetch', version: '2025.4.7', command: 'mcp-server-fetch', dependencies: [{ package: 'mcp', version: '1.30.0' }] },
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    license: 'MIT',
    fields: [],
    tools: ['fetch'],
    instructions: ['Python 3.10 이상과 uv를 설치하세요.', '이 서버는 현재 사용자 계정의 권한으로 네트워크 요청을 보낼 수 있습니다.'],
  },
  {
    id: 'heygen',
    name: 'HeyGen Video',
    description: '아바타 영상과 음성을 만들고 기존 영상을 번역합니다.',
    icon: 'heygen',
    color: '#8764d8',
    source: { kind: 'remote', url: 'https://mcp.heygen.com/mcp/v1/', auth: 'oauth' },
    homepage: 'https://developers.heygen.com/mcp/overview',
    license: 'Hosted service terms',
    fields: [],
    tools: ['아바타 영상 만들기', '아바타 만들기', '음성 생성', '영상 번역', '영상 진행 상태 확인'],
    instructions: [
      '연결한 뒤 브라우저에서 HeyGen 계정으로 로그인하세요.',
      '사용 가능한 작업은 계정과 승인한 접근 범위에 따라 달라집니다. HeyGen 서비스 약관과 사용 요금이 적용됩니다.',
    ],
  },
  {
    id: 'recraft',
    name: 'Recraft Design',
    description: '벡터 작품과 재사용 가능한 스타일을 만들고 이미지를 편집하며 배경을 제거합니다.',
    icon: 'recraft',
    color: '#ce7952',
    source: { kind: 'remote', url: 'https://mcp.recraft.ai/mcp', auth: 'oauth' },
    homepage: 'https://www.recraft.ai/docs/mcp-reference/remote-server',
    license: 'Hosted service terms',
    fields: [],
    tools: ['래스터 및 벡터 이미지 생성', '이미지 벡터화', '배경 제거 또는 교체', '이미지 확대', '사용자 지정 스타일 만들기'],
    instructions: [
      '연결한 뒤 브라우저에서 Recraft 계정으로 로그인하세요.',
      '중단된 로컬 MCP 패키지를 대체하는 운영 중인 호스팅 서비스입니다. Recraft 서비스 약관과 사용 요금이 적용됩니다.',
    ],
  },
  {
    id: 'unity',
    name: 'Unity Editor',
    description: 'Unity Editor에서 장면을 만들고 GameObject와 머티리얼을 편집하며 테스트를 실행합니다.',
    icon: 'unity',
    color: '#668da0',
    source: { kind: 'python', package: 'mcpforunityserver', version: '10.2.0', command: 'mcp-for-unity', args: ['--transport', 'stdio'] },
    homepage: 'https://github.com/CoplayDev/unity-mcp',
    license: 'MIT',
    fields: [],
    tools: ['manage_scene', 'manage_gameobject', 'manage_material', 'run_tests', 'read_console'],
    instructions: [
      'Python 3.10 이상, uv, Unity 2021.3 LTS 이상을 설치하세요.',
      'Unity Package Manager에 https://github.com/CoplayDev/unity-mcp.git?path=/MCPForUnity#v10.2.0 링크를 추가하세요. Window → MCP for Unity를 열고 stdio 전송 방식을 선택하세요.',
      '도구를 사용하는 동안 Unity 프로젝트를 열어 두세요. 이 커뮤니티 통합은 Coplay/Aura가 관리하며 Unity Technologies와 제휴되어 있지 않습니다.',
    ],
  },
];

/** Reviewed notices belong to an exact distribution, never every version of a package. */
export function reviewedPluginLicense(source: PluginSource, fallback: string): string {
  return pluginCatalog.find(recipe => recipe.source.kind === source.kind &&
    recipe.source.package === source.package && recipe.source.version === source.version &&
    (source.kind === 'npm' || source.kind === 'python'))?.license ?? fallback;
}
