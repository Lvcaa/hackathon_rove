import streamlit as st

st.set_page_config(page_title="Hackathon Rove AI", layout="wide")

st.title("Hackathon Rove AI")
st.write("Starter Streamlit app is running.")

message = st.text_input("Message", "Hello from the hackathon container")

if st.button("Echo"):
    st.success(message)
