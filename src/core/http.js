/**
 * HTTP access: `requestHttp` sends absolute URLs (pale.tools, FUT.GG prices) through the best
 * available transport and relative paths to the Web App's UTAS API; `canAccessExternalHosts`
 * is the memoized connectivity check. Used by check-for-updates, unassigned-count, the club
 * analyzer, the FUT.GG provider and the external-price and price-tracker features.
 *
 * Invariants:
 * - Absolute URLs ('http...') use the first available of: `GM_xmlhttpRequest`,
 *   `window.invokePaletoolsAction` (native-app bridge, called synchronously with the JSON
 *   {command: 'http', commandArgs: {url, method, body, options}} and expected to return
 *   {success, status, responseText}; an external protocol), `window.corsBridge.fetch`, `fetch`.
 * - GM and bridge results are plain {status, ok, responseText, json()} objects, the others real
 *   Responses; callers must accept both (check-for-updates tests for `text`).
 * - Other paths go to `<utasSession.url>/ut/game/fifa<APP_YEAR_SHORT>/<path>` with the
 *   `X-UT-SID` header and a JSON body and resolve to the parsed JSON; `requestOptions` is
 *   ignored there.
 * - `canAccessExternalHosts` is true with GM or the bridge; otherwise it probes
 *   `paletoolsBaseUrl` with HEAD (3 s abort). The GM and probe answers are cached.
 *
 * Known issues (kept as-is):
 * - When external hosts are unreachable, `requestHttp` only creates a discarded promise and
 *   sends the request anyway.
 */
import { extendObject } from "./objects.js";

export const paletoolsBaseUrl = "https://pale.tools";

export async function requestHttp(urlOrPath, method, body, requestOptions = null) {
  if (!urlOrPath) {
    throw new Error("Url must be specified");
  }
  if (urlOrPath.indexOf("http") === 0) {
    if (!(await canAccessExternalHosts())) {
      new Promise((resolve) => resolve());
    }
    return await (function (externalUrl, method, data, extraOptions) {
      if (typeof GM_xmlhttpRequest !== "undefined") {
        return new Promise((resolve, reject) => {
          let requestDetails = extendObject(
            {
              method: method || "GET",
              url: externalUrl,
              onload: (gmResponse) =>
                resolve({
                  status: gmResponse.status,
                  ok: gmResponse.status >= 200 && gmResponse.status < 300,
                  responseText: gmResponse.responseText,
                  json: () =>
                    new Promise((resolveJson) => {
                      resolveJson(JSON.parse(gmResponse.responseText));
                    }),
                }),
              onerror: (gmErrorResponse) => reject(gmErrorResponse.responseText),
              data: data,
            },
            extraOptions,
          );
          GM_xmlhttpRequest(requestDetails);
        });
      } else if (window.invokePaletoolsAction) {
        return new Promise((resolve, reject) => {
          var actionResponse = window.invokePaletoolsAction(
            JSON.stringify({
              command: "http",
              commandArgs: {
                url: externalUrl,
                method: method,
                body: data,
                options: extraOptions,
              },
            }),
          );
          if (!actionResponse.success) {
            reject(actionResponse.responseText);
          }
          resolve({
            status: actionResponse.status,
            ok:
              actionResponse.success &&
              (actionResponse.status == null ||
                (actionResponse.status >= 200 && actionResponse.status < 300)),
            responseText: actionResponse.responseText,
            json: () =>
              new Promise((resolveJson) => {
                resolveJson(JSON.parse(actionResponse.responseText));
              }),
          });
        });
      } else if (window.corsBridge) {
        extraOptions = extendObject(
          {
            method: method,
            body: data,
          },
          extraOptions,
        );
        return window.corsBridge.fetch(externalUrl, extraOptions);
      } else {
        extraOptions = extendObject(
          {
            method: method,
            body: data,
          },
          extraOptions,
        );
        return fetch(externalUrl, extraOptions);
      }
    })(urlOrPath, method, body, requestOptions);
  }
  {
    const utasResponse = await fetch(
      services.Authentication.utasSession.url + "/ut/game/fifa" + APP_YEAR_SHORT + "/" + urlOrPath,
      {
        method: method || "GET",
        headers: {
          "X-UT-SID": services.Authentication.getUtasSession().id,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : null,
      },
    );
    return await utasResponse.json();
  }
}

let cachedExternalConnectivity;

export async function canAccessExternalHosts() {
  if (cachedExternalConnectivity !== undefined) {
    return cachedExternalConnectivity;
  } else if (typeof GM_xmlhttpRequest !== "undefined") {
    cachedExternalConnectivity = true;
    return true;
  } else {
    return (
      !!window.invokePaletoolsAction ||
      ((await (async function () {
        const probeUrls = [paletoolsBaseUrl];
        for (const probeUrl of probeUrls) {
          try {
            const abortController = new AbortController();
            setTimeout(() => abortController.abort(), 3000);
            if (
              (
                await fetch(probeUrl, {
                  method: "HEAD",
                  signal: abortController.signal,
                  cache: "no-store",
                })
              ).ok
            ) {
              return true;
            }
          } catch {}
        }
        return false;
      })())
        ? ((cachedExternalConnectivity = true), true)
        : ((cachedExternalConnectivity = false), false))
    );
  }
}
