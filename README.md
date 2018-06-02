This repository is for internal training use only.

Brief
==
It customizes load-balancing & reverse-proxying by the `master-process` to mimic the behavior of ["Nginx consistent hash"](http://nginx.org/en/docs/http/ngx_http_upstream_module.html#hash) for query param `roomid`.

Compared with other load-balancer & reverse-proxy software, e.g. Nginx, the `master-process` of a NodeJs cluster still uses up to only 1 duty thread and thus up to only 1 CPU core.

See [this note](https://app.yinxiang.com/shard/s61/nl/13267014/3dfaf88a-80ed-415a-82fa-5891471016d0) for more information.

Testing
==

```
user@proj-root> node server.js
user@proj-root> node test_client_ws_conn 1 1
user@proj-root> node test_client_ws_conn 2 2
user@proj-root> node test_client_ws_conn 3 3
user@proj-root> node test_client_ws_conn 4 1
user@proj-root> node test_client_ws_conn 5 2
user@proj-root> node test_client_ws_conn 6 3
user@proj-root> node test_client_ws_conn 7 9
```
