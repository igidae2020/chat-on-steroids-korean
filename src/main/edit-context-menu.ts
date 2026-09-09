import type { ContextMenuParams, Menu, MenuItemConstructorOptions } from 'electron';

/** Translate labels only; Electron retains each native role, shortcut and click handler. */
export function localizeNativeMenu(menu: Menu): void {
  const labels: Record<string, string> = {
    filemenu: '파일', editmenu: '편집', viewmenu: '보기', windowmenu: '창', help: '도움말',
    about: '앱 정보', services: '서비스', hide: '숨기기', hideothers: '다른 앱 숨기기',
    unhide: '모두 표시', quit: '종료', undo: '실행 취소', redo: '다시 실행',
    cut: '잘라내기', copy: '복사', paste: '붙여넣기', pasteandmatchstyle: '서식 없이 붙여넣기',
    delete: '삭제', selectall: '모두 선택', reload: '새로고침', forcereload: '강력 새로고침',
    toggledevtools: '개발자 도구 전환', resetzoom: '실제 크기', zoomin: '확대', zoomout: '축소',
    togglefullscreen: '전체 화면 전환', minimize: '최소화', zoom: '창 확대', close: '창 닫기',
    front: '모든 창을 앞으로', window: '창', startspeaking: '읽기 시작', stopspeaking: '읽기 중단'
  };
  const headings: Record<string, string> = {
    File: '파일', Edit: '편집', View: '보기', Window: '창', Help: '도움말', Speech: '음성',
    'Learn More': '자세히 알아보기', Documentation: '문서', 'Community Discussions': '커뮤니티 토론', 'Search Issues': '이슈 검색'
  };
  for (const item of menu.items) {
    const label = labels[item.role?.toLowerCase() ?? ''] ?? headings[item.label.replace(/&/g, '')];
    if (label) item.label = label;
    if (item.submenu) localizeNativeMenu(item.submenu);
  }
}

/** Native roles retain Chromium's current selection, undo history and trusted paste
 * event. Image paste therefore reaches the composer's existing attachment importer. */
export function editContextMenuTemplate(
  params: Pick<ContextMenuParams, 'isEditable' | 'editFlags'>
): MenuItemConstructorOptions[] {
  if (!params.isEditable) return [];
  return [
    { role: 'cut', label: '잘라내기', enabled: params.editFlags.canCut },
    { role: 'copy', label: '복사', enabled: params.editFlags.canCopy },
    { role: 'paste', label: '붙여넣기', enabled: params.editFlags.canPaste },
    { role: 'selectAll', label: '모두 선택', enabled: params.editFlags.canSelectAll }
  ];
}
