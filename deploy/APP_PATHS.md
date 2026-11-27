# IP routing on port 80

The configuration in `nginx-app-paths.conf` serves:

| Path | App |
| --- | --- |
| `/` | Intelligence Portal on `127.0.0.1:3001` (including its assets and API) |
| `/renewals/` | Horizon build in `/usr/share/nginx/html/renewals` |
| `/renewals/api/` | Backend on `127.0.0.1:8000`, with `/api/` preserved |
| `/operator/` | Operator service on `127.0.0.1:4001` |
| `/enterprise/` | Enterprise service on `127.0.0.1:4002` |
| `/customer/` | Customer service on `127.0.0.1:4003` |

All addresses use `http://10.10.51.71`. Existing port 3002 and hostname configurations are left in place. Existing services must already be running.

From the repository root:

```bash
npm --prefix frontend run build:paths
sudo bash deploy/install-app-paths.sh
```

The installer backs up `mobileum.conf`, copies the separate subpath build, validates Nginx, reloads it, and checks the renewals frontend/API and operator page. A configuration or reload failure restores the old configuration. The original frontend build is not overwritten. Rebuild and rerun the installer to publish subsequent changes to `/renewals/`.

The portal locations strip their prefix before forwarding. They rewrite legacy root URLs in HTML, JavaScript, CSS, and JSON to scope API requests and shared assets to each portal. This uses Nginx's [response substitution module](https://nginx.org/en/docs/http/ngx_http_sub_module.html); review these rules when portal URL handling changes. File downloads and images are not filtered.

Verify after installation:

```bash
curl -f http://10.10.51.71/renewals/api/health
curl -f http://10.10.51.71/operator/api/info
```

Open `/renewals/`, navigate to `/renewals/expiry`, refresh that page, and open `/operator/` in a browser. Netskope access must also be checked from the client network.
