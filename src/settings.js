// Global game settings shared by the UI and the renderer.
//   mode 'action' = realistic animals, brutal kill-cam battles
//   mode 'kids'   = cute characters, playful no-blood battles
export const settings = { mode: 'action' };

export const isKids = () => settings.mode === 'kids';
