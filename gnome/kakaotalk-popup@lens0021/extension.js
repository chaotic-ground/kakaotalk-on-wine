// A loader, so that impl.js can be reloaded without logging out.
//
// GNOME Shell imports an extension's module once and keeps it. Disabling and
// re-enabling calls disable() and enable() on the object it already has, and
// its D-Bus interface offers no reload, so on a Wayland session -- where the
// shell itself cannot be restarted -- an edit to extension.js does not take
// effect until the next login. Which makes iterating on one expensive.
//
// A dynamic import with a changing query string misses that cache. So this
// file, which never changes, pulls in impl.js afresh on every enable():
//
//   gnome-extensions disable kakaotalk-popup@lens0021
//   gnome-extensions enable kakaotalk-popup@lens0021
//
// picks up whatever impl.js now says.
//
// enable() cannot wait for the import, so the real object arrives late and
// disable() has to cope with being called before it does.

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const TAG = '[kakaotalk-popup]';

export default class KakaoTalkPopupLoader extends Extension {
    enable() {
        this._enabled = true;
        this._impl = null;

        const url = `${this.dir.get_child('impl.js').get_uri()}?v=${Date.now()}`;
        import(url).then(module => {
            if (!this._enabled)
                return;
            this._impl = new module.default(this);
            this._impl.enable();
        }).catch(e => {
            console.log(`${TAG} impl.js failed to load: ${e}`);
        });
    }

    disable() {
        this._enabled = false;
        this._impl?.disable();
        this._impl = null;
    }
}
