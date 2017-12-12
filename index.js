'use strict';

const AWS = require("aws-sdk");
AWS.config.update({region: "us-west-2"});
const docClient = new AWS.DynamoDB.DocumentClient();
const fetch = require("node-fetch");


exports.handlerHttp = (event, context, callback) => {

    let sku = event['pathParameters']['SKU'];
    let countryCode = event['pathParameters']['CountryCode'];
    const done = (err, res) => callback(null, {
        statusCode: err ? '400' : '200',
        body: err ? err.message : JSON.stringify(res),
        headers: {
            'Content-Type': 'application/json',
        },
    });

    getSku(sku, countryCode, done);
};



exports.handler = (event, context, callback) => {
    let keys = [];
    event.Items.forEach(function(item){
        keys.push({SKU:item.SKU, CountryCode: event.CountryCode});
    });
    console.log("Keys:", keys);
    docClient.batchGet({ RequestItems: {Inventory: { Keys: keys,} }},  function(err, data) {

        if(err){
            console.log("ERROR", err);
        }else{
            callback(err, data.Responses.Inventory);
        }
    });
};


const create = function (event, context, callback) {
    let sku = event.sku;
    let countryCode = event.countryCode;
    loadSKU(sku, countryCode, done);

};


const updateSKU = function(event, context, callback) {
    let message = event.Records[0].Sns.Message;
    console.log('Message received from SNS:', message);
    loadSKU(message.sku, message.countryCode, callback);
};



const allocate = (event, context, callback) => {

    let params = {
        TableName:"Inventory",
        Key: {
            SKU : event.sku,
            CountryCode: event.countryCode,
        },
        UpdateExpression: "set qty = qty - :requestQuantity",
        ConditionExpression: "qty > :requestQuantity",
        ExpressionAttributeValues:{
            ":requestQuantity":event.requestedQuantity
        },
        ReturnValues:"ALL_NEW"
    };

    docClient.update(params,function(err, data){
        console.log("Return from update", data);

        console.log("now:", Date.now() - data.Attributes.timestamp);


        if(Date.now() > data.Attributes.timestamp + 60000){
            console.log("Time to update inventory");
            let sns = new AWS.SNS();

            sns.publish({
                Message: JSON.stringify(data.Attributes),
                TopicArn: SNS_TOPIC_ARN
            }, function(err, data) {
                if (err) {
                    console.log("ERRIR" + err.stack);
                    return;
                }
                console.log('push sent');
                console.log(data);
                context.done(null, 'Function Finished!');
            });
        }

    });
};



const loadSKU = function(sku, countryCode, callback) {
    let body = {"CountryCode":countryCode,"Region":"","Item":[{"SKU":sku,"RequestedQuantity":"1"}]};

    fetch('https://www.nuskin.com/shop-service/api/v1/inventory/atp', {
        method: 'POST',
        body:    JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' , 'client_id':'735b1eb810304bba966af0891ab54053', 'client_secret':'0deea37049e84157A406C0C01D29F300'},
    })
        .then((response) => {
        if (response.ok) {
        return response;
    }
    return Promise.reject(new Error(
        `Failed to fetch ${response.url}: ${response.status} ${response.statusText}`));
})
.then(response => response.buffer())
.then((buffer) => {

        const product = JSON.parse(buffer);
    docClient.put({
        TableName: 'Inventory',
        Item: {SKU: sku, CountryCode: countryCode, qty: product.ATPCheckResponse.Item[0].TotalAvailableQuantity, timestamp: Date.now()}
    },   function(err, data) {
        if (err) {
            console.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2));
        } else {
            console.log("Added item:", JSON.stringify(data, null, 2));
            callback(err, data);
        }
    });
}
)
};


const getSku = function(sku, countryCode, callback) {
    docClient.get({
        TableName: 'Inventory',
        Key: {SKU: sku, CountryCode: countryCode}
    },  function(err, data) {
        if(!data.Item){
            loadSKU(sku, countryCode, function(err, data){
                if(!err){
                    getSku(sku, countryCode, callback)
                }else{
                    callback(err, data); //error loading SKU from SAP
                }
            });
        }else{
            callback(err, data);
        }
    });
};





