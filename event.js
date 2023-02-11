// @version 0.0.3 新增了环境变量，以解决aircode 的时不时抽风问题
const aircode = require('aircode');
const lark = require('@larksuiteoapi/node-sdk');
var axios = require('axios');
const EventDB = aircode.db.table('event');

// 如果你不想配置环境变量，或环境变量不生效，则可以把结果填写在每一行最后的 "" 内部
const FEISHU_APP_ID = process.env.APPID || "";  // 飞书的应用 ID
const FEISHU_APP_SECRET = process.env.SECRET  || ""; // 飞书的应用的 Secret
const FEISHU_BOTNAME = process.env.BOTNAME || ""; // 飞书机器人的名字
const OPENAI_KEY = process.env.KEY || ""; // OpenAI 的 Key
const OPENAI_MODEL = process.env.MODEL || "text-davinci-003"; // 使用的模型
const OPENAI_MAX_TOKEN = process.env.MAX_TOKEN || 1024; // 最大 token 的值

const client = new lark.Client({
    appId: FEISHU_APP_ID,
    appSecret: FEISHU_APP_SECRET,
    disableTokenCache: false
});

// 回复消息
async function reply(messageId, content) {
    return await client.im.message.reply({
        path: {
            message_id: messageId,
        },
        data: {
            content: JSON.stringify({
                "text": content
            }),
            msg_type: 'text',
        }
    })
}

// 根据中英文设置不同的 prompt
function getPrompt(content) {
  if(content.length == 0) {
    return ''
  }
  if((content[0] >= 'a' && content[0] <= 'z') || (content[0] >= 'A' && content[0] <= 'Z')) {
    return "You are ChatGPT, a LLM model trained by OpenAI. \nplease answer my following question\nQ: " + content + "\nA: ";
  }
  
  return "你是 ChatGPT, 一个由 OpenAI 训练的大型语言模型, 你旨在回答并解决人们的任何问题，并且可以使用多种语言与人交流。\n请回答我下面的问题\nQ: " + content + "\nA: ";
}


// 通过 OpenAI API 获取回复
async function getOpenAIReply(content) {
    var prompt = getPrompt(content.trim());
  
    var data = JSON.stringify({
        "model": OPENAI_MODEL,
        "prompt": prompt,
        "max_tokens": OPENAI_MAX_TOKEN,
        "temperature": 0.9,
        "frequency_penalty": 0.0,
        "presence_penalty": 0.0,
        "top_p": 1,
        "stop": ["#"]
    });

    var config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'https://api.openai.com/v1/completions',
        headers: {
            'Authorization': `Bearer ${OPENAI_KEY}`,
            'Content-Type': 'application/json'
        },
        data: data
    };

    const response = await axios(config)
    // 去除多余的换行
    return response.data.choices[0].text.replace("\n\n", "")
}

module.exports = async function (params, context) {
    // 处理飞书开放平台的服务端校验
    if (params.type == "url_verification") {
        return {
            challenge: params.challenge
        }
    }
    // 处理飞书开放平台的事件回调
    if (params.header.event_type = "im.message.receive_v1") {

        let eventId = params.header.event_id;
        let messageId = params.event.message.message_id;

        // 对于同一个事件，只处理一次
        const count = await EventDB.where({ event_id: eventId }).count();
        if (count != 0) {
            return { code: 1 }
        }
        await EventDB.save({ event_id: eventId })



        // 私聊直接回复
        if (params.event.message.chat_type == "p2p") {
            // 不是文本消息，不处理
            if (params.event.message.message_type != "text") {
                await reply(messageId, "暂不支持其他类型的提问")
            }
            // 是文本消息，直接回复
            const userInput = JSON.parse(params.event.message.content);
            const openaiResponse = await getOpenAIReply(userInput.text)
            await reply(messageId, openaiResponse)
        }


        // 群聊，需要 @ 机器人
        if (params.event.message.chat_type == "group") {
            // 这是日常群沟通，不用管
            if (!params.event.message.mentions || params.event.message.mentions.length == 0) {
                return { "code": 0 }
            }
            // 没有 mention 机器人，则退出。
            if (params.event.message.mentions[0].name != FEISHU_BOTNAME) {
                return { "code": 0 }
            }
            const userInput = JSON.parse(params.event.message.content);
            const question = userInput.text.replace("@_user_1", "");
            const openaiResponse = await getOpenAIReply(question)
            await reply(messageId, openaiResponse)
            return { "code": 0 }
        }
    }
    return {
        code: 2
    };
}
