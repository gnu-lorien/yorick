export function useConfigPubstorm() {
  return {
    serverURL: 'https://stagingapi.undergroundtheater.org/parse',
    facebookAppId: '1606746326305984',
    redirect_uri: 'https://stagingpatron.undergroundtheater.org/index.html',
  }
}

export function useConfigPatron() {
  return {
    serverURL: 'https://api.undergroundtheater.org/parse',
    facebookAppId: '1606746326305984',
    redirect_uri: 'https://patron.undergroundtheater.org',
  }
}

export function useConfigLocalhost() {
  return {
    serverURL: 'http://localhost:1337/parse',
    facebookAppId: '1607159299598020',
    redirect_uri: 'http://localhost/index.html',
  }
}

export function useConfigGnuLorienLocalhost() {
  return {
    serverURL: 'http://localhost:1337/parse/1',
    facebookAppId: '1607159299598020',
    redirect_uri: 'http://localhost:63342/yorick/public/index.html',
    SAMPLE_TROUPE_ID: 'k7zf9B7bwV',
  }
}

export function useConfigC9() {
  return {
    serverURL: 'https://yorick-latest-parse-server-gnu-lorien.c9users.io/parse',
    redirect_uri: 'https://yorick-latest-parse-server-gnu-lorien.c9users.io/index.html',
    SAMPLE_TROUPE_ID: 'mXhRByDNxX',
  }
}

export function useConfigHeroku() {
  return {
    serverURL: 'https://young-plateau-55863.herokuapp.com/parse',
    facebookAppId: '202279720650237',
    redirect_uri: 'https://sheets.ourislandgeorgia.net/index.html',
    SAMPLE_TROUPE_ID: 'mXhRByDNxX',
  }
}

export function useConfigDefault() {
  return useConfigGnuLorienLocalhost()
}

export function useConfigTestDefault() {
  return useConfigGnuLorienLocalhost()
}
