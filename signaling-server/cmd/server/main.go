package main

import (
	"log"
	"net/http"

	"peerpad/signaling-server/internal/room"
	"peerpad/signaling-server/internal/ws"
)

func main() {
	registry := room.NewRegistry()
	server := ws.NewServer(registry)

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("/ws", server.HandleWS)

	addr := ":8080"
	log.Printf("signaling server listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
