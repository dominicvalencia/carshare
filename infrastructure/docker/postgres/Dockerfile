FROM postgres:17-alpine3.21

RUN apk add --no-cache postgis \
  && cp -a /usr/share/postgresql17/extension/. /usr/local/share/postgresql/extension/ \
  && cp -a /usr/lib/postgresql17/. /usr/local/lib/postgresql/
