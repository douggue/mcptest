// Functional and timing test for the engine's in-process proxy (engine/Bcore/src/main/cpp/Utils/ProxyHook.cpp).
//
// Runs on an Android device or emulator (see native-tests/run.sh). The hook functions are called
// directly, so no hooking library is needed: a mock proxy in this process answers SOCKS5 and
// HTTP CONNECT after a configurable delay (the time a real proxy needs to reach the target), and
// then serves a small test service chosen by the destination port.
//
// The main thing measured is what an app with ONE network thread sees (TikTok, anything built on
// Cronet): while it opens new connections, does data on its other connections keep flowing?
#include <sys/epoll.h>
#include <netinet/tcp.h>
#include <signal.h>
#include <stdarg.h>
#include <algorithm>
#include <atomic>
#include <vector>
#include <sys/time.h>
#include <pthread.h>
#include <time.h>
#include <thread>
#include <functional>

#include "Utils/ProxyHook.cpp"

// --- stand-ins for the hooking libraries -----------------------------------------------------
void *xdl_open(const char *, int) { return (void *) 1; }
void *xdl_close(void *) { return nullptr; }
void *xdl_dsym(void *, const char *symbol, size_t *) { return dlsym(RTLD_DEFAULT, symbol); }
int DobbyHook(void *address, void *, void **origin) { *origin = address; return 0; }

namespace {

int64_t now_ms() {
    timespec ts{};
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (int64_t) ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

int g_failures = 0;
void check(bool ok, const char *what, const char *fmt = "", ...) {
    char detail[256] = "";
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(detail, sizeof detail, fmt, ap);
    va_end(ap);
    printf("  %s  %s %s\n", ok ? "PASS" : "FAIL", what, detail);
    fflush(stdout);
    if (!ok) g_failures++;
}

uint8_t pattern(size_t i) { return (uint8_t) ((i * 31 + 7) & 0xFF); }

// --- mock proxy --------------------------------------------------------------------------------
enum Port { kStream = 7001, kEcho = 7002, kBlob = 7003, kRefuse = 7004, kBanner = 7005 };

struct Mock {
    int port = 0;
    std::atomic<int> delayMs{300};
    std::atomic<bool> dropEarly{false};   // discard bytes sent before the greeting was answered
    std::mutex m;
    std::string user, pass;
    std::vector<std::string> seen;        // "host:port" of every request
} g_mock;

bool rd(int fd, void *b, size_t n) { return recv_all(fd, b, n); }
bool wr(int fd, const void *b, size_t n) { return send_all(fd, b, n); }

void serve(int fd, int port, const std::string &first) {
    if (port == kStream) {
        char chunk[1024];
        memset(chunk, 'v', sizeof chunk);
        while (wr(fd, chunk, sizeof chunk)) usleep(10 * 1000);
    } else if (port == kBlob) {
        uint32_t n = 0;
        if (!rd(fd, &n, 4)) return;
        n = ntohl(n);
        std::vector<uint8_t> buf(64 * 1024);
        size_t sent = 0;
        while (sent < n) {
            size_t k = std::min(buf.size(), (size_t) n - sent);
            for (size_t i = 0; i < k; i++) buf[i] = pattern(sent + i);
            if (!wr(fd, buf.data(), k)) return;
            sent += k;
        }
    } else {   // echo (also after the banner)
        if (!first.empty() && !wr(fd, first.data(), first.size())) return;
        char buf[16384];
        for (;;) {
            ssize_t r = recv(fd, buf, sizeof buf, 0);
            if (r <= 0) break;
            if (!wr(fd, buf, (size_t) r)) return;
        }
        shutdown(fd, SHUT_WR);
    }
}

void record(const std::string &host, int port) {
    std::lock_guard<std::mutex> g(g_mock.m);
    g_mock.seen.push_back(host + ":" + std::to_string(port));
}

void mock_socks(int fd) {
    uint8_t h[2];
    if (!rd(fd, h, 2) || h[0] != 5) return;
    uint8_t methods[255];
    if (!rd(fd, methods, h[1])) return;
    if (g_mock.dropEarly.load()) {
        usleep(100 * 1000);
        char junk[1024];
        while (recv(fd, junk, sizeof junk, MSG_DONTWAIT) > 0) {}
    }
    std::string user, pass;
    { std::lock_guard<std::mutex> g(g_mock.m); user = g_mock.user; pass = g_mock.pass; }
    bool needAuth = !user.empty();
    uint8_t want = needAuth ? 2 : 0;
    bool offered = false;
    for (int i = 0; i < h[1]; i++) offered |= methods[i] == want;
    uint8_t sel[2] = {5, (uint8_t) (offered ? want : 0xFF)};
    if (!wr(fd, sel, 2) || !offered) return;
    if (needAuth) {
        uint8_t a[2];
        if (!rd(fd, a, 2)) return;
        std::string u(a[1], '\0');
        if (!rd(fd, &u[0], a[1])) return;
        uint8_t pl;
        if (!rd(fd, &pl, 1)) return;
        std::string p(pl, '\0');
        if (!rd(fd, &p[0], pl)) return;
        bool ok = u == user && p == pass;
        uint8_t ar[2] = {1, (uint8_t) (ok ? 0 : 1)};
        if (!wr(fd, ar, 2) || !ok) return;
    }
    uint8_t q[4];
    if (!rd(fd, q, 4) || q[1] != 1) return;
    std::string host;
    if (q[3] == 1) {
        uint8_t a[4]; if (!rd(fd, a, 4)) return;
        char b[32]; snprintf(b, sizeof b, "%d.%d.%d.%d", a[0], a[1], a[2], a[3]); host = b;
    } else if (q[3] == 3) {
        uint8_t l; if (!rd(fd, &l, 1)) return;
        host.assign(l, '\0'); if (!rd(fd, &host[0], l)) return;
    } else if (q[3] == 4) {
        uint8_t a[16]; if (!rd(fd, a, 16)) return; host = "v6";
    } else return;
    uint8_t pp[2];
    if (!rd(fd, pp, 2)) return;
    int port = pp[0] << 8 | pp[1];
    record(host, port);
    usleep(g_mock.delayMs.load() * 1000);
    uint8_t rep[10] = {5, (uint8_t) (port == kRefuse ? 5 : 0), 0, 1, 0, 0, 0, 0, 0, 0};
    if (port == kBanner) {   // reply and first tunnel bytes in ONE segment
        std::string both((const char *) rep, 10);
        both += "HELLO";
        if (!wr(fd, both.data(), both.size())) return;
        serve(fd, port, "");
        return;
    }
    if (!wr(fd, rep, 10) || port == kRefuse) return;
    serve(fd, port, "");
}

void mock_http(int fd) {
    std::string req;
    char ch;
    while (req.size() < 8192) {
        if (!rd(fd, &ch, 1)) return;
        req += ch;
        if (req.size() >= 4 && req.compare(req.size() - 4, 4, "\r\n\r\n") == 0) break;
    }
    if (req.compare(0, 8, "CONNECT ") != 0) return;
    size_t sp = req.find(' ', 8);
    std::string hp = req.substr(8, sp - 8);
    size_t colon = hp.rfind(':');
    std::string host = hp.substr(0, colon);
    int port = atoi(hp.substr(colon + 1).c_str());
    std::string user, pass;
    { std::lock_guard<std::mutex> g(g_mock.m); user = g_mock.user; pass = g_mock.pass; }
    if (!user.empty() && req.find("Proxy-Authorization: Basic " + b64(user + ":" + pass) + "\r\n") == std::string::npos) {
        const char *no = "HTTP/1.1 407 Proxy Authentication Required\r\n\r\n";
        wr(fd, no, strlen(no));
        return;
    }
    record(host, port);
    usleep(g_mock.delayMs.load() * 1000);
    if (port == kRefuse) {
        const char *no = "HTTP/1.1 502 Bad Gateway\r\n\r\n";
        wr(fd, no, strlen(no));
        return;
    }
    std::string ok = "HTTP/1.1 200 Connection established\r\n\r\n";
    if (port == kBanner) ok += "HELLO";
    if (!wr(fd, ok.data(), ok.size())) return;
    serve(fd, port, "");
}

std::atomic<int> g_mockType{1};

void mock_start() {
    int l = socket(AF_INET, SOCK_STREAM, 0);
    int one = 1;
    setsockopt(l, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (bind(l, (sockaddr *) &a, sizeof a) != 0 || listen(l, 1024) != 0) { perror("mock listen"); exit(2); }
    socklen_t al = sizeof a;
    getsockname(l, (sockaddr *) &a, &al);
    g_mock.port = ntohs(a.sin_port);
    std::thread([l] {
        for (;;) {
            int fd = accept(l, nullptr, nullptr);
            if (fd < 0) continue;
            int one = 1;
            setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
            std::thread([fd] {
                if (g_mockType.load() == 1) mock_socks(fd); else mock_http(fd);
                close(fd);
            }).detach();
        }
    }).detach();
}

void configure(int type, const char *user, const char *pass, int delayMs, bool dropEarly = false) {
    { std::lock_guard<std::mutex> g(g_mock.m); g_mock.user = user; g_mock.pass = pass; g_mock.seen.clear(); }
    g_mock.delayMs = delayMs;
    g_mock.dropEarly = dropEarly;
    g_mockType = type;
    if (!ProxyHook_configure(type, "127.0.0.1", g_mock.port, user, pass, true)) { printf("configure failed\n"); exit(2); }
}

bool mock_saw(const std::string &hp) {
    std::lock_guard<std::mutex> g(g_mock.m);
    for (auto &s : g_mock.seen) if (s == hp) return true;
    return false;
}

// --- client helpers ----------------------------------------------------------------------------
const char *kPublicIp = "93.184.216.34";   // any public address; the mock proxy never dials it

socklen_t make_addr(int family, const char *ip4, int port, sockaddr_storage &ss) {
    memset(&ss, 0, sizeof ss);
    if (family == AF_INET) {
        sockaddr_in *s = (sockaddr_in *) &ss;
        s->sin_family = AF_INET; s->sin_port = htons((uint16_t) port);
        inet_pton(AF_INET, ip4, &s->sin_addr);
        return sizeof *s;
    }
    sockaddr_in6 *s = (sockaddr_in6 *) &ss;   // v4-mapped, as Java's dual-stack sockets do
    s->sin6_family = AF_INET6; s->sin6_port = htons((uint16_t) port);
    s->sin6_addr.s6_addr[10] = 0xFF; s->sin6_addr.s6_addr[11] = 0xFF;
    inet_pton(AF_INET, ip4, s->sin6_addr.s6_addr + 12);
    return sizeof *s;
}

// Non-blocking connect through the hook. Returns the fd (or -1); *callMs is how long connect() took.
int nb_connect_sa(int family, const sockaddr *sa, socklen_t len, int64_t *callMs = nullptr, int *rcOut = nullptr) {
    int fd = socket(family, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
    if (fd < 0) return -1;
    int64_t t0 = now_ms();
    int rc = my_connect(fd, sa, len);
    int err = errno;
    if (callMs) *callMs = now_ms() - t0;
    if (rcOut) *rcOut = rc;
    if (rc != 0 && err != EINPROGRESS) { close(fd); errno = err; return -1; }
    return fd;
}

int nb_connect(int family, int port, int64_t *callMs = nullptr) {
    sockaddr_storage ss;
    socklen_t len = make_addr(family, kPublicIp, port, ss);
    return nb_connect_sa(family, (sockaddr *) &ss, len, callMs);
}

bool wait_writable(int fd, int timeoutMs) {
    pollfd p{fd, POLLOUT, 0};
    if (poll(&p, 1, timeoutMs) <= 0) return false;
    int err = 0;
    socklen_t el = sizeof err;
    return getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &el) == 0 && err == 0;
}

void make_blocking(int fd, int timeoutSec) {
    int fl = fcntl(fd, F_GETFL, 0);
    fcntl(fd, F_SETFL, fl & ~O_NONBLOCK);
    timeval tv{timeoutSec, 0};
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof tv);
}

// connect (non-blocking), wait, switch to blocking for simple request/response code
int open_tunnel(int family, int port, int waitMs = 8000) {
    int fd = nb_connect(family, port);
    if (fd < 0) return -1;
    if (!wait_writable(fd, waitMs)) { close(fd); return -1; }
    make_blocking(fd, 20);
    return fd;
}

bool ping(int fd) {
    char b[4];
    return wr(fd, "ping", 4) && rd(fd, b, 4) && memcmp(b, "ping", 4) == 0;
}

// --- tests ---------------------------------------------------------------------------------------

// One thread, one epoll loop: a "video" stream arrives in 1 KB pieces every 10 ms while the same
// thread opens `count` more connections. Reports how long connect() held the thread and the
// longest silence on the stream.
void test_event_loop(const char *name, int count) {
    printf("%s\n", name);
    int ep = epoll_create1(0);
    int stream = open_tunnel(AF_INET, kStream);
    if (stream < 0) { check(false, "stream tunnel opens"); return; }
    pollfd first{stream, POLLIN, 0};    // the clock starts once the stream is running
    if (poll(&first, 1, 10000) <= 0) { check(false, "stream delivers data"); close(stream); return; }
    fcntl(stream, F_SETFL, fcntl(stream, F_GETFL, 0) | O_NONBLOCK);
    epoll_event ev{};
    ev.events = EPOLLIN; ev.data.fd = stream;
    epoll_ctl(ep, EPOLL_CTL_ADD, stream, &ev);

    struct C { int fd; int state; };   // 0 connecting, 1 ping sent, 2 done
    std::vector<C> conns;
    int done = 0;
    int64_t start = now_ms(), lastChunk = start, maxGap = 0, maxCall = 0, sumCall = 0, maxPlain = 0, allDone = -1;
    size_t streamBytes = 0;
    auto send_ping = [&](C &c) { if (send(c.fd, "ping", 4, MSG_NOSIGNAL) == 4) c.state = 1; };
    while (now_ms() - start < 30000) {
        int64_t t = now_ms() - start;
        if ((int) conns.size() < count && t >= 300 + (int64_t) conns.size() * 20) {
            // For comparison: the same call to a loopback address, which the hook leaves alone.
            sockaddr_storage lo;
            socklen_t loLen = make_addr(AF_INET, "127.0.0.1", g_mock.port, lo);
            int64_t plain = 0;
            int pfd = nb_connect_sa(AF_INET, (sockaddr *) &lo, loLen, &plain);
            if (pfd >= 0) close(pfd);
            maxPlain = std::max(maxPlain, plain);
            int64_t call = 0;
            int fd = nb_connect(AF_INET, kEcho, &call);
            maxCall = std::max(maxCall, call);
            sumCall += call;
            conns.push_back({fd, 0});
            if (fd >= 0) {
                epoll_event e{};
                e.events = EPOLLIN | EPOLLOUT; e.data.fd = fd;
                epoll_ctl(ep, EPOLL_CTL_ADD, fd, &e);
            }
        }
        epoll_event evs[32];
        int n = epoll_wait(ep, evs, 32, 5);
        for (int i = 0; i < n; i++) {
            int fd = evs[i].data.fd;
            if (fd == stream) {
                char buf[8192];
                ssize_t r;
                while ((r = recv(stream, buf, sizeof buf, 0)) > 0) streamBytes += (size_t) r;
                int64_t now = now_ms();
                if (now - start > 300) maxGap = std::max(maxGap, now - lastChunk);
                lastChunk = now;
                continue;
            }
            for (auto &c : conns) {
                if (c.fd != fd) continue;
                if (c.state == 0 && (evs[i].events & EPOLLOUT)) {
                    send_ping(c);
                    epoll_event e{};
                    e.events = EPOLLIN; e.data.fd = fd;
                    epoll_ctl(ep, EPOLL_CTL_MOD, fd, &e);
                } else if (c.state == 1 && (evs[i].events & EPOLLIN)) {
                    char b[4];
                    if (recv(fd, b, 4, 0) == 4 && memcmp(b, "ping", 4) == 0) { c.state = 2; done++; }
                }
            }
        }
        if (done == count && allDone < 0) allDone = now_ms() - start - 300;
        if (allDone >= 0 && now_ms() - start > 300 + allDone + 300) break;
    }
    int delay = g_mock.delayMs.load();
    printf("  proxy needs %d ms per connection; %d connections opened by one thread\n", delay, count);
    printf("  connect() held the thread: longest %lld ms, total %lld ms (an unproxied loopback connect: longest %lld ms)\n",
           (long long) maxCall, (long long) sumCall, (long long) maxPlain);
    printf("  longest silence on the stream: %lld ms (data is sent every 10 ms, %zu KB arrived)\n",
           (long long) maxGap, streamBytes / 1024);
    printf("  all %d connections usable after: %lld ms\n", count, (long long) allDone);
    check(done == count, "every connection carried data", "(%d of %d)", done, count);
    // "At once" = it does not wait for the proxy. The margin is for a busy emulator.
    check(maxCall < delay / 3, "connect() returns at once", "(longest %lld ms)", (long long) maxCall);
    check(maxGap < delay / 2, "the stream keeps flowing while connections open", "(longest silence %lld ms)", (long long) maxGap);
    check(allDone >= 0 && allDone < count * 20 + delay + 1500, "connections are set up side by side, not one after another",
          "(%lld ms)", (long long) allDone);
    for (auto &c : conns) if (c.fd >= 0) close(c.fd);
    close(stream);
    close(ep);
}

void test_download(int family, uint32_t bytes) {
    int fd = open_tunnel(family, kBlob);
    if (fd < 0) { check(false, "download tunnel opens"); return; }
    uint32_t n = htonl(bytes);
    wr(fd, &n, 4);
    std::vector<uint8_t> buf(64 * 1024);
    size_t got = 0;
    bool same = true;
    int64_t t0 = now_ms();
    for (;;) {
        ssize_t r = recv(fd, buf.data(), buf.size(), 0);
        if (r <= 0) break;
        for (ssize_t i = 0; i < r; i++) same &= buf[(size_t) i] == pattern(got + (size_t) i);
        got += (size_t) r;
    }
    int64_t ms = std::max<int64_t>(1, now_ms() - t0);
    check(got == bytes && same, family == AF_INET ? "download arrives complete and unchanged (IPv4 socket)"
                                                  : "download arrives complete and unchanged (dual-stack socket)",
          "(%zu bytes, %lld MB/s)", got, (long long) (got / 1048576 * 1000 / ms));
    close(fd);
}

void test_upload_echo(uint32_t bytes) {
    int fd = open_tunnel(AF_INET, kEcho);
    if (fd < 0) { check(false, "echo tunnel opens"); return; }
    std::thread writer([fd, bytes] {
        std::vector<uint8_t> buf(32 * 1024);
        size_t sent = 0;
        while (sent < bytes) {
            size_t k = std::min(buf.size(), (size_t) bytes - sent);
            for (size_t i = 0; i < k; i++) buf[i] = pattern(sent + i);
            if (!wr(fd, buf.data(), k)) break;
            sent += k;
        }
        shutdown(fd, SHUT_WR);   // half-close: the echo must still be delivered in full
    });
    std::vector<uint8_t> buf(64 * 1024);
    size_t got = 0;
    bool same = true;
    for (;;) {
        ssize_t r = recv(fd, buf.data(), buf.size(), 0);
        if (r <= 0) break;
        for (ssize_t i = 0; i < r; i++) same &= buf[(size_t) i] == pattern(got + (size_t) i);
        got += (size_t) r;
    }
    writer.join();
    check(got == bytes && same, "upload is echoed back complete after a half-close", "(%zu bytes)", got);
    close(fd);
}

void test_domain() {
    addrinfo hints{};
    hints.ai_socktype = SOCK_STREAM;
    addrinfo *res = nullptr;
    int rc = my_getaddrinfo("video.example.com", "7002", &hints, &res);
    if (rc != 0 || !res) { check(false, "fake DNS answers"); return; }
    int fd = nb_connect_sa(AF_INET, res->ai_addr, res->ai_addrlen);
    freeaddrinfo(res);
    bool ok = fd >= 0 && wait_writable(fd, 8000);
    if (ok) { make_blocking(fd, 20); ok = ping(fd); }
    check(ok && mock_saw("video.example.com:7002"), "host names reach the proxy by name");
    if (fd >= 0) close(fd);
}

void test_refused(const char *what, int port) {
    int64_t call = 0;
    int fd = nb_connect(AF_INET, port, &call);
    bool failed = fd < 0;
    if (!failed) {
        if (!wait_writable(fd, 20000)) failed = true;
        else {
            make_blocking(fd, 20);
            char b[4];
            ssize_t r = recv(fd, b, 4, 0);   // a refusal shows as a reset or an immediate end
            failed = r <= 0;
        }
        close(fd);
    }
    check(failed, what);
}

void test_banner() {
    int fd = open_tunnel(AF_INET, kBanner);
    char b[5] = {};
    bool ok = fd >= 0 && rd(fd, b, 5) && memcmp(b, "HELLO", 5) == 0 && ping(fd);
    check(ok, "bytes the server sends right behind the proxy's reply are not lost");
    if (fd >= 0) close(fd);
}

void test_blocking_socket() {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    sockaddr_storage ss;
    socklen_t len = make_addr(AF_INET, kPublicIp, kEcho, ss);
    timeval tv{20, 0};
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
    bool ok = my_connect(fd, (sockaddr *) &ss, len) == 0 && ping(fd);
    check(ok, "blocking sockets still work");
    close(fd);
}

void test_many(int count) {
    std::vector<int> fds;
    int64_t t0 = now_ms();
    for (int i = 0; i < count; i++) fds.push_back(nb_connect(i % 2 ? AF_INET6 : AF_INET, kEcho));
    int ok = 0;
    for (int fd : fds) {
        if (fd < 0) continue;
        if (wait_writable(fd, 15000)) { make_blocking(fd, 15); if (ping(fd)) ok++; }
    }
    int64_t ms = now_ms() - t0;
    for (int fd : fds) if (fd >= 0) close(fd);
    check(ok == count, "many connections at the same time", "(%d of %d in %lld ms)", ok, count, (long long) ms);
}

void test_udp_block() {
    int fd = socket(AF_INET, SOCK_DGRAM, 0);
    sockaddr_storage ss;
    socklen_t len = make_addr(AF_INET, "8.8.8.8", 53, ss);
    int rc = my_connect(fd, (sockaddr *) &ss, len);
    check(rc == -1 && errno == ENETUNREACH, "UDP to public addresses is refused");
    close(fd);
}

void test_no_pipeline_proxy() {
    // A proxy that throws away anything sent before it answered the greeting.
    int64_t t0 = now_ms();
    int fd = open_tunnel(AF_INET, kEcho, 20000);
    bool first = fd >= 0 && ping(fd);
    int64_t firstMs = now_ms() - t0;
    if (fd >= 0) close(fd);
    t0 = now_ms();
    fd = open_tunnel(AF_INET, kEcho, 20000);
    bool second = fd >= 0 && ping(fd);
    int64_t secondMs = now_ms() - t0;
    if (fd >= 0) close(fd);
    printf("  first connection: %s after %lld ms; second: %s after %lld ms\n", first ? "ok" : "lost",
           (long long) firstMs, second ? "ok" : "lost", (long long) secondMs);
    check(first, "a proxy that needs step-by-step login: the first connection is not lost");
    check(second && secondMs < 3000, "a proxy that needs step-by-step login: later connections are quick");
}

}  // namespace

int main(int argc, char **argv) {
    setvbuf(stdout, nullptr, _IOLBF, 0);
    signal(SIGPIPE, SIG_IGN);
    const char *tbl = argc > 1 ? argv[1] : "/data/local/tmp/proxy_test.tbl";
    unlink(tbl);
    ProxyHook_setDnsTable(tbl);
    mock_start();

    configure(1, "", "", 1000);
    test_event_loop("SOCKS5, one network thread, proxy needs 1 s per connection", 20);

    printf("SOCKS5 with login\n");
    configure(1, "user1", "secret", 50);
    test_domain();
    test_download(AF_INET, 24u * 1024 * 1024);
    test_download(AF_INET6, 8u * 1024 * 1024);
    test_upload_echo(6u * 1024 * 1024);
    test_banner();
    test_blocking_socket();
    test_refused("a refused destination is reported as a failed connection", kRefuse);
    test_udp_block();
    test_many(300);

    printf("SOCKS5, wrong password\n");
    { std::lock_guard<std::mutex> g(g_mock.m); g_mock.pass = "other"; }
    test_refused("a rejected login is reported as a failed connection", kEcho);

    printf("SOCKS5 proxy that needs step-by-step login\n");
    configure(1, "user1", "secret", 50, true);
    test_no_pipeline_proxy();

    printf("Proxy not reachable\n");
    ProxyHook_configure(1, "127.0.0.1", 1, "", "", true);
    test_refused("a dead proxy is reported as a failed connection", kEcho);

    configure(2, "user1", "secret", 1000);
    test_event_loop("HTTP CONNECT, one network thread, proxy needs 1 s per connection", 20);
    printf("HTTP CONNECT with login\n");
    configure(2, "user1", "secret", 50);
    test_domain();
    test_download(AF_INET, 8u * 1024 * 1024);
    test_banner();
    test_refused("a refused destination is reported as a failed connection", kRefuse);

    printf("%s (%d failed)\n", g_failures ? "FAILED" : "ALL PASSED", g_failures);
    return g_failures ? 1 : 0;
}
