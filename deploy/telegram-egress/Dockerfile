# syntax=docker/dockerfile:1.7

FROM alpine:3.23@sha256:fd791d74b68913cbb027c6546007b3f0d3bc45125f797758156952bc2d6daf40

RUN apk add --no-cache \
    curl=8.20.0-r0 \
    openssh-client-default=10.2_p1-r0 \
    squid=7.6-r0 \
    tini=0.19.0-r3

COPY squid.conf /etc/squid/squid.conf
COPY entrypoint /usr/local/bin/telegram-egress

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/telegram-egress"]
CMD ["proxy"]
