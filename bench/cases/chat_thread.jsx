<ChatScreen>
  <Thread>
    {messages.map((msg) => (
      <Bubble key={msg.id} role={msg.role}>
        <span>{msg.author}: </span>
        {msg.text}
      </Bubble>
    ))}
  </Thread>
  <Composer
    value={draft}
    placeholder="Type a message"
    onInput={(event) => onDraft(event)}
    onEnter={() => sendMessage()}
  />
</ChatScreen>
