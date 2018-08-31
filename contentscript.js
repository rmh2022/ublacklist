const _ = s => chrome.i18n.getMessage(s);

class UBlacklist {
  constructor() {
    this.blockedSiteCount = 0;
    this.queuedSites = [];
    this.styleSheetsLoaded = false;

    chrome.storage.local.get({ blacklist: '' }, options => {
      this.onBlacklistLoaded(options.blacklist);
    });

    new MutationObserver(records => {
      this.onDOMContentMutated(records);
    }).observe(document.documentElement, { childList: true, subtree: true });

    document.addEventListener('DOMContentLoaded', () => {
      this.onDOMContentLoaded();
    });
  }

  onBlacklistLoaded(blacklist) {
    this.blockRules = [];
    if (blacklist) {
      for (const raw of blacklist.split(/\n/)) {
        const compiled = UBlacklist.compileBlockRule(raw);
        this.blockRules.push({ raw, compiled });
      }
    }
    for (const site of this.queuedSites) {
      this.judgeSite(site);
    }
  }

  onDOMContentMutated(records) {
      if (!this.styleSheetsLoaded && document.head) {
        this.setupStyleSheets();
        this.styleSheetsLoaded = true;
      }
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.matches && node.matches('.g')) {
          this.setupBlockLinks(node);
          if (this.blockRules) {
            this.judgeSite(node);
          } else {
            this.queuedSites.push(node);
          }
        }
      }
    }
    this.updateControl();
  }

  onDOMContentLoaded() {
    this.setupControl();
    this.setupBlockDialogs();
  }

  setupStyleSheets() {
    const baseStyle = document.createElement('style');
    document.head.appendChild(baseStyle);
    baseStyle.sheet.insertRule('#uBlacklistHideLink { display: none; }');
    baseStyle.sheet.insertRule('.uBlacklistBlocked { display: none; }');
    baseStyle.sheet.insertRule('.uBlacklistBlocked .uBlacklistBlockLink { display: none; }');
    baseStyle.sheet.insertRule('.uBlacklistUnblockLink { display: none; }');
    baseStyle.sheet.insertRule('.uBlacklistBlocked .uBlacklistUnblockLink { display: inline; }');

    const showStyle = document.createElement('style');
    showStyle.id = 'uBlacklistShowStyle';
    document.head.appendChild(showStyle);
    showStyle.sheet.disabled = true;
    showStyle.sheet.insertRule('#uBlacklistShowLink { display: none; }');
    showStyle.sheet.insertRule('#uBlacklistHideLink { display: inline; }');
    showStyle.sheet.insertRule('.uBlacklistBlocked { background-color: #ffe0e0; display: block; }');
  }

  setupBlockLinks(site) {
    const f = site.querySelector('.f');
    const pageLink = site.querySelector('a');
    if (f && pageLink && pageLink.href) {
      const blockLink = document.createElement('a');
      blockLink.className = 'fl uBlacklistBlockLink';
      blockLink.href = 'javascript:void(0)';
      blockLink.textContent = _('blockThisSite');
      blockLink.addEventListener('click', () => {
        if (this.blockRules) {
          document.getElementById('uBlacklistBlockInput').value = new URL(pageLink.href).origin + '/*';
          document.getElementById('uBlacklistBlockDialog').showModal();
        }
      });

      const unblockLink = document.createElement('a');
      unblockLink.className = 'fl uBlacklistUnblockLink';
      unblockLink.href = 'javascript:void(0)';
      unblockLink.textContent = _('unblockThisSite');
      unblockLink.addEventListener('click', () => {
        if (this.blockRules) {
          const unblockSelect = document.getElementById('uBlacklistUnblockSelect');
          while (unblockSelect.firstChild) {
            unblockSelect.removeChild(unblockSelect.firstChild);
          }
          this.blockRules.forEach((rule, index) => {
            if (rule.compiled && rule.compiled.test(pageLink.href)) {
              const option = document.createElement('option');
              option.textContent = rule.raw;
              option.value = String(index);
              unblockSelect.appendChild(option);
            }
          });
          document.getElementById('uBlacklistUnblockDialog').showModal();
        }
      });

      f.appendChild(document.createTextNode('\u00a0'));
      f.appendChild(blockLink);
      f.appendChild(unblockLink);
    }
  }

  setupControl() {
    const resultStats = document.getElementById('resultStats');
    if (resultStats) {
      const stats = document.createElement('span');
      stats.id = 'uBlacklistStats';

      const showLink = document.createElement('a');
      showLink.id = 'uBlacklistShowLink';
      showLink.href = 'javascript:void(0)';
      showLink.textContent = _('show');
      showLink.addEventListener('click', () => {
        document.getElementById('uBlacklistShowStyle').sheet.disabled = false;
      });

      const hideLink = document.createElement('a');
      hideLink.id = 'uBlacklistHideLink';
      hideLink.href = 'javascript:void(0)';
      hideLink.textContent = _('hide');
      hideLink.addEventListener('click', () => {
        document.getElementById('uBlacklistShowStyle').sheet.disabled = true;
      });

      const control = document.createElement('span');
      control.id = 'uBlacklistControl';
      control.appendChild(stats);
      control.appendChild(document.createTextNode('\u00a0'));
      control.appendChild(showLink);
      control.appendChild(hideLink);

      resultStats.appendChild(control);

      this.updateControl();
    }
  }

  setupBlockDialogs() {
    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="uBlacklistBlockDialog" style="padding:0">
        <form id="uBlacklistBlockForm" style="padding:1em">
          <label>
            ${_('blockThisSite')}:
            <input id="uBlacklistBlockInput" type="text" size="40" style="margin:0.5em">
          </label>
          <button type="submit">${_('ok')}</button>
        </form>
      </dialog>
      <dialog id="uBlacklistUnblockDialog" style="padding:0">
        <form id="uBlacklistUnblockForm" style="padding:1em">
          <label>
            ${_('unblockThisSite')}:
            <select id="uBlacklistUnblockSelect" style="margin:0.5em;width:20em">
            </select>
          </label>
          <button type="submit">${_('ok')}</button>
        </form>
      </dialog>
    `);

    const blockDialog = document.getElementById('uBlacklistBlockDialog');
    document.getElementById('uBlacklistBlockForm').addEventListener('submit', event => {
      event.preventDefault();
      const raw = document.getElementById('uBlacklistBlockInput').value;
      const compiled = UBlacklist.compileBlockRule(raw);
      if (compiled) {
        this.blockRules.push({ raw, compiled });
        this.rejudgeAllSites();
        this.saveBlacklist();
      }
      blockDialog.close();
    });
    blockDialog.addEventListener('click', event => {
      if (event.target == blockDialog) {
        blockDialog.close();
      }
    });

    const unblockDialog = document.getElementById('uBlacklistUnblockDialog');
    document.getElementById('uBlacklistUnblockForm').addEventListener('submit', event => {
      event.preventDefault();
      this.blockRules.splice(Number(document.getElementById('uBlacklistUnblockSelect').value), 1);
      this.rejudgeAllSites();
      this.saveBlacklist();
      unblockDialog.close();
    });
    unblockDialog.addEventListener('click', event => {
      if (event.target == unblockDialog) {
        unblockDialog.close();
      }
    });
  }

  judgeSite(site) {
    const pageLink = site.querySelector('a');
    if (pageLink && pageLink.href &&
        this.blockRules.some(rule => rule.compiled && rule.compiled.test(pageLink.href))) {
      site.classList.add('uBlacklistBlocked');
      ++this.blockedSiteCount;
    }
  }

  rejudgeAllSites() {
    this.blockedSiteCount = 0;
    for (const site of document.querySelectorAll('.g')) {
      site.classList.remove('uBlacklistBlocked');
      this.judgeSite(site);
    }
    this.updateControl();
  }

  saveBlacklist() {
    chrome.storage.local.set({ blacklist: this.blockRules.map(rule => rule.raw).join('\n') });
  }

  updateControl() {
    const control = document.getElementById('uBlacklistControl');
    if (control) {
      if (this.blockedSiteCount) {
        const stats = document.getElementById('uBlacklistStats');
        stats.textContent = _('nSitesBlocked').replace('%d', this.blockedSiteCount);
        control.style.display = 'inline';
      } else {
        control.style.display = 'none';
      }
    }
  }

  static compileBlockRule(raw) {
    const escapeRegExp = s => s.replace(/[$^\\.*+?()[\]{}|]/g, '\\$&');
    raw = raw.trim();
    const wc = raw.match(/^((\*)|http|https|file|ftp):\/\/(?:(\*)|(\*\.)?([^\/*]+))(\/.*)$/);
    if (wc) {
      return new RegExp(
        '^' +
        (wc[2] ? '(http|https)' : wc[1]) +
        '://' +
        (wc[3] ? '[^/]+' : (wc[4] ? '([^/]+\\.)?' + escapeRegExp(wc[5]) : escapeRegExp(wc[5]))) +
        escapeRegExp(wc[6]).replace('\\*', '.*') +
        '$'
      );
    }
    const re = raw.match(/^\/((?:[^*\\/[]|\\.|\[(?:[^\]\\]|\\.)*\])(?:[^\\/[]|\\.|\[(?:[^\]\\]|\\.)*\])*)\/(.*)$/);
    if (re) {
      try {
        return new RegExp(re[1], re[2]);
      } catch (e) {
        console.warn('uBlacklist: invalid regular expression: ' + raw);
        return null;
      }
    }
    return null;
  }
}

new UBlacklist();
