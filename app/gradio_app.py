import gradio as gr


def echo(message: str) -> str:
    return f"You said: {message}"


demo = gr.Interface(
    fn=echo,
    inputs=gr.Textbox(label="Message"),
    outputs=gr.Textbox(label="Response"),
    title="Hackathon Rove AI Demo",
)


if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860)
